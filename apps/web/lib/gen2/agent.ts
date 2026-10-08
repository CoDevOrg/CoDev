import { getDynamicModelsForProvider } from "../providers/dynamic-models";
import "server-only";

import { logEvent } from "../platform/observability";
import {
  HostedCodexSubscriptionError,
  resolveHostedCodexSubscription,
  updateHostedCodexAuthCache,
} from "../providers/hosted-codex-subscription-credentials";
import {
  describeSeatHolder,
  releaseCredentialSeat,
  retagCredentialSeat,
  waitForCredentialSeat,
} from "../providers/credential-seat";
import { resolveGen2Credential, type Gen2AgentProvider } from "./providers";
import { OrchestratorError } from "../runtime/orchestrator-request";
import { ensureHostReady } from "../runtime/orchestrator-health";
import {
  closeCodexExecInSandbox,
  pollCodexExecInSandbox,
  startCodexExecInSandbox,
} from "../runtime/orchestrator-codex-exec";
import { pollPersistedArmTurn } from "./arm-workspace-turn-poll";
import { Gen2AccessError, Gen2LifecycleError } from "./errors";
import { describeGen2RuntimeFailure } from "./instance";
import { canRunGen2Agent } from "./agent-policy";
import {
  appendGen2ChatMessage,
  listGen2ChatMessages,
  requireGen2Chat,
} from "./chats";
import { buildGen2AgentCommand } from "./agent-command";
import {
  createGen2Turn,
  getGen2TurnProvider,
  recordGen2TurnChunks,
} from "./turns";
import { withDatabaseOperation } from "../platform/database-operation";
import { isGen2AgentCoordinationEnabled } from "./agent-coordination-feature";
import { withNativeCoordinationHooks } from "./agent-coordination-hooks";
import { findPossibleDuplicateTask } from "./duplicate-task-check";
import { avoidBlockedCliModel } from "./agent-cli-fallback";
import { refreshCursorTurnAuth } from "./cursor-auth-refresh";
import { isGen2SupersetAgentSessionsEnabled } from "./superset-agent-sessions-feature";
import {
  cancelGen2SupersetAgentTurn,
  pollGen2SupersetAgentTurn,
  startGen2SupersetAgentTurn,
} from "./superset-agent-runtime";
import { requireWorkspaceOwnerPlan } from "../billing/gate";
import { requireGen2Member } from "./workspaces";

export { canRunGen2Agent } from "./agent-policy";
export { buildGen2CodexCommand } from "./codex-command";

async function requireReadyMember(workspaceId: string, userId: string) {
  const membership = await requireGen2Member(workspaceId, userId);
  if (!canRunGen2Agent(membership.status)) {
    throw new Gen2LifecycleError(
      membership.status === "provisioning"
        ? "The instance is still starting."
        : "Start the instance before asking Codex to work.",
    );
  }
  return membership;
}

export async function startGen2AgentTurn(input: {
  workspaceId: string;
  userId: string;
  chatId: string;
  prompt: string;
  idempotencyKey: string;
  provider: Gen2AgentProvider;
  worktreeId?: string | undefined;
  model?: string | undefined;
  acknowledgedDuplicateOf?: string | undefined;
  /** A re-run of the latest prompt on a fallback model, with its history. */
  continuation?: {
    history: Array<{ role: "user" | "assistant"; body: string }>;
  };
}) {
  const membership = await requireReadyMember(input.workspaceId, input.userId);
  if (membership.role === "viewer")
    throw new Gen2AccessError(
      "Edit permission is required to run agents.",
      403,
    );
  await requireWorkspaceOwnerPlan(input.workspaceId);
  await requireGen2Chat(input.workspaceId, input.chatId);
  const possibleDuplicate = input.continuation
    ? null
    : await findPossibleDuplicateTask(input);
  if (
    possibleDuplicate &&
    possibleDuplicate.runId !== input.acknowledgedDuplicateOf
  ) {
    return { possibleDuplicate };
  }

  const models = await getDynamicModelsForProvider(
    input.provider,
    input.userId,
  ).catch(() => {
    throw new Gen2LifecycleError(
      "Couldn't load your account's models. Please refresh and try again.",
      503,
    );
  });
  const requested = input.model ?? models[0]?.id;
  if (!requested || !models.some((entry) => entry.id === requested))
    throw new Gen2LifecycleError(
      "This model isn't available for your connected account. Refresh the model picker and choose an available model.",
      400,
    );
  // A model the live workspace CLI is known not to support runs on the
  // closest one it does, with a note, until the CLI update ships.
  const { model, note: fallbackNote } = input.continuation
    ? { model: requested, note: null }
    : await avoidBlockedCliModel(input.provider, requested, models);
  if (!model) throw new Gen2LifecycleError(fallbackNote!, 409);

  // Cursor uses the provider-neutral guest exec until Superset supports its CLI.
  if (isGen2SupersetAgentSessionsEnabled() && input.provider !== "cursor") {
    return startGen2AgentTurnViaSuperset({ ...input, model });
  }

  const history =
    input.continuation?.history ?? (await listGen2ChatMessages(input.chatId));
  const provider = input.provider;
  const credential = await resolveGen2Credential(input.userId, provider);

  // Only a subscription holds a seat. An API key has no one-turn-at-a-time
  // limit, so claiming one would invent a restriction the provider does not.
  //
  // This used to claim the seat and then swallow a busy result, running the
  // turn anyway — while stamping the credential unavailable for sixteen
  // minutes, which did block the member's chat-room replies. Now it waits for
  // the seat like every other executor, and says what holds it if it cannot
  // get one.
  const seatRef = input.idempotencyKey;
  if (credential.credentialId) {
    const claim = await waitForCredentialSeat({
      credentialId: credential.credentialId,
      userId: input.userId,
      surface: "gen2",
      ref: seatRef,
    });
    if (!claim.held) {
      throw new Gen2LifecycleError(describeSeatHolder(claim.holder), 409);
    }
  }
  const command = buildGen2AgentCommand(provider, input.prompt, history, model);
  const execInput = {
    ...(isGen2AgentCoordinationEnabled(input.workspaceId)
      ? {
          ...withNativeCoordinationHooks(
            provider,
            command,
            credential.launchProfile,
          ),
          coordination: true,
        }
      : { command, launchProfile: credential.launchProfile }),
    idempotencyKey: input.idempotencyKey,
    ...(input.worktreeId && input.worktreeId !== "main"
      ? { worktreeId: input.worktreeId }
      : {}),
  };
  try {
    let sessionId: string;
    try {
      sessionId = await startCodexExecInSandbox(input.workspaceId, execInput);
    } catch (error) {
      if (
        !/Firecracker host could not be reached/.test(
          describeGen2RuntimeFailure(error),
        )
      ) {
        throw error;
      }
      await ensureHostReady();
      sessionId = await startCodexExecInSandbox(input.workspaceId, execInput);
    }
    try {
      if (!input.continuation)
        await appendGen2ChatMessage({
          chatId: input.chatId,
          role: "user",
          body: input.prompt,
        });
      if (fallbackNote)
        await appendGen2ChatMessage({
          chatId: input.chatId,
          role: "assistant",
          body: fallbackNote,
        });
    } catch (error) {
      logEvent("error", "gen2.agent.persist_user_failed", {
        detail: error instanceof Error ? error.message : "unknown",
      });
    }
    // From here the server owns the transcript: every poll appends to this
    // row, so the reply survives the browser going away mid-turn.
    await createGen2Turn({
      sessionId,
      provider,
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      userId: input.userId,
      model,
      worktreeId:
        input.worktreeId && input.worktreeId !== "main"
          ? input.worktreeId
          : null,
    });
    if (credential.credentialId) {
      // The poll and cleanup paths know the session id and nothing else, so
      // the seat moves onto it now that there is one.
      await retagCredentialSeat({
        credentialId: credential.credentialId,
        fromRef: seatRef,
        toRef: sessionId,
      });
    }
    return {
      sessionId,
      ...(fallbackNote ? { fallback: { from: requested, to: model } } : {}),
    };
  } catch (error) {
    if (credential.credentialId) {
      await releaseCredentialSeat({
        credentialId: credential.credentialId,
        ref: seatRef,
      });
    }
    logEvent("error", "gen2.agent.start_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    if (error instanceof OrchestratorError && error.status === 404) {
      throw new Gen2LifecycleError(
        "The instance is not running. Start it and try again.",
      );
    }
    if (
      error instanceof Gen2AccessError ||
      error instanceof Gen2LifecycleError ||
      error instanceof HostedCodexSubscriptionError
    ) {
      throw error;
    }
    throw new Gen2LifecycleError(describeGen2RuntimeFailure(error), 502);
  }
}

/**
 * Phase 4's Superset flow: same failure translation as the direct sandbox
 * path above, delegated to `startGen2SupersetAgentTurn` (which owns the
 * credential claim, worktree selection, durable run row, and chat/turn
 * persistence -- see superset-agent-runtime.ts).
 */
async function startGen2AgentTurnViaSuperset(input: {
  workspaceId: string;
  userId: string;
  chatId: string;
  prompt: string;
  idempotencyKey: string;
  provider: Gen2AgentProvider;
  worktreeId?: string | undefined;
  model?: string | undefined;
}) {
  try {
    return await startGen2SupersetAgentTurn(input);
  } catch (error) {
    logEvent("error", "gen2.agent.start_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    if (error instanceof OrchestratorError && error.status === 404) {
      throw new Gen2LifecycleError(
        "The instance is not running. Start it and try again.",
      );
    }
    if (
      error instanceof Gen2AccessError ||
      error instanceof Gen2LifecycleError ||
      error instanceof HostedCodexSubscriptionError
    ) {
      throw error;
    }
    throw new Gen2LifecycleError(describeGen2RuntimeFailure(error), 502);
  }
}

export async function pollGen2AgentTurn(
  input: Parameters<typeof pollGen2AgentTurnOperation>[0],
) {
  return withDatabaseOperation(() => pollGen2AgentTurnOperation(input));
}

async function pollGen2AgentTurnOperation(input: {
  workspaceId: string;
  userId: string;
  chatId?: string;
  sessionId: string;
  after: number;
}) {
  const membership = await requireGen2Member(input.workspaceId, input.userId);

  if (
    isGen2SupersetAgentSessionsEnabled() &&
    (await getGen2TurnProvider(input.sessionId)) !== "cursor"
  ) {
    return pollGen2AgentTurnViaSuperset(input);
  }

  let result;
  let armPoll: Awaited<ReturnType<typeof pollPersistedArmTurn>> | null = null;
  try {
    if (membership.runtimeProvider === "azure_arm")
      armPoll = await pollPersistedArmTurn(input);
    result =
      armPoll ??
      (await pollCodexExecInSandbox(
        input.workspaceId,
        input.sessionId,
        input.after,
      ));
  } catch (error) {
    logEvent("error", "gen2.agent.poll_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    if (error instanceof OrchestratorError && error.status === 404) {
      await releasePersonalCodex(input.userId, input.sessionId);
      throw new Gen2LifecycleError(
        "This turn is no longer running. Send the prompt again.",
      );
    }
    throw new Gen2LifecycleError(describeGen2RuntimeFailure(error), 502);
  }

  const persisted = armPoll
    ? armPoll.persisted
    : await recordGen2TurnChunks({
        sessionId: input.sessionId,
        chunks: result.chunks,
        exited: result.exited,
        exitCode: result.exitCode,
      });

  if (
    result.exited &&
    result.codexAuthCacheJson &&
    (await getGen2TurnProvider(input.sessionId)) === "cursor"
  ) {
    await refreshCursorTurnAuth(input.sessionId, result.codexAuthCacheJson);
  }

  // The hosted ChatGPT seat and its refreshed auth cache belong to Codex
  // turns only; another provider's turn has neither to hand back.
  if (
    result.exited &&
    (await getGen2TurnProvider(input.sessionId)) === "codex"
  ) {
    const hosted = await resolveHostedCodexSubscription({
      userId: input.userId,
    });
    if (hosted?.credential.id) {
      try {
        if (result.codexAuthCacheJson) {
          await updateHostedCodexAuthCache(
            hosted.credential.id,
            result.codexAuthCacheJson,
          );
        }
      } finally {
        await releaseCredentialSeat({
          credentialId: hosted.credential.id,
          ref: input.sessionId,
        });
      }
    }
  }

  // After the turn's transaction committed: a CLI too old for the model
  // re-runs the turn on a fallback model, which the browser then follows.
  const continuation = result.exited
    ? await import("./agent-cli-continuation")
    : null;
  const continuedAs = !continuation
    ? null
    : persisted?.cliRequirement
      ? await continuation.continueOnFallbackModel(
          input.sessionId,
          persisted.cliRequirement,
        )
      : await continuation.continuedSessionId(input.sessionId);

  return {
    chunks: result.chunks,
    nextSequence: result.nextSequence,
    exited: result.exited,
    exitCode: result.exitCode,
    // Present only on the poll that ends the turn: the reply the server
    // already saved, so the client does not have to save it too.
    reply: persisted?.reply ?? null,
    persistedMessageId: persisted?.messageId ?? null,
    continuedAs,
  };
}

/**
 * Phase 4's Superset flow for polling. `pollGen2SupersetAgentTurn` owns the
 * durable run lookup, output recording, and lease release on exit -- see
 * superset-agent-runtime.ts.
 */
async function pollGen2AgentTurnViaSuperset(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
  after: number;
}) {
  try {
    return await pollGen2SupersetAgentTurn(input);
  } catch (error) {
    logEvent("error", "gen2.agent.poll_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    if (error instanceof Gen2LifecycleError) {
      throw error;
    }
    if (error instanceof OrchestratorError && error.status === 404) {
      throw new Gen2LifecycleError(
        "This turn is no longer running. Send the prompt again.",
      );
    }
    throw new Gen2LifecycleError(describeGen2RuntimeFailure(error), 502);
  }
}

export async function cancelGen2AgentTurn(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
}) {
  await requireGen2Member(input.workspaceId, input.userId);

  if (
    isGen2SupersetAgentSessionsEnabled() &&
    (await getGen2TurnProvider(input.sessionId)) !== "cursor"
  ) {
    try {
      await cancelGen2SupersetAgentTurn(input);
    } catch (error) {
      if (error instanceof Gen2LifecycleError) {
        throw error;
      }
      throw new Gen2LifecycleError(describeGen2RuntimeFailure(error), 502);
    }
    return;
  }

  try {
    await closeCodexExecInSandbox(input.workspaceId, input.sessionId);
  } catch (error) {
    if (!(error instanceof OrchestratorError && error.status === 404)) {
      throw new Gen2LifecycleError(describeGen2RuntimeFailure(error), 502);
    }
  } finally {
    await releasePersonalCodex(input.userId, input.sessionId);
  }
}

async function releasePersonalCodex(userId: string, sessionId: string) {
  if ((await getGen2TurnProvider(sessionId)) !== "codex") return;
  const hosted = await resolveHostedCodexSubscription({
    userId,
  });
  if (hosted?.credential.id) {
    await releaseCredentialSeat({
      credentialId: hosted.credential.id,
      ref: sessionId,
    });
  }
}
