import "server-only";

import { logEvent } from "../platform/observability";
import {
  claimHostedCodexExecution,
  HostedCodexSubscriptionError,
  releaseHostedCodexExecution,
  resolveHostedCodexSubscription,
  updateHostedCodexAuthCache,
} from "../providers/hosted-codex-subscription-credentials";
import { resolveGen2Codex } from "./providers";
import { getAgentModel } from "../providers/ai-model";
import { OrchestratorError } from "../runtime/orchestrator-request";
import { ensureHostReady } from "../runtime/orchestrator-health";
import {
  closeCodexExecInSandbox,
  pollCodexExecInSandbox,
  startCodexExecInSandbox,
} from "../runtime/orchestrator-codex-exec";
import { Gen2AccessError, Gen2LifecycleError } from "./errors";
import { describeGen2RuntimeFailure } from "./instance";
import { canRunGen2Agent } from "./agent-policy";
import {
  appendGen2ChatMessage,
  listGen2ChatMessages,
  requireGen2Chat,
} from "./chats";
import { formatGen2TurnPrompt } from "./chats-format";
import { createGen2Turn, recordGen2TurnChunks } from "./turns";
import { requireGen2Member } from "./workspaces";

export { canRunGen2Agent } from "./agent-policy";

export function buildGen2CodexCommand(
  prompt: string,
  history: Array<{ role: "user" | "assistant"; body: string }> = [],
) {
  return [
    "codex",
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--sandbox",
    "danger-full-access",
    "-c",
    'approval_policy="never"',
    "--model",
    getAgentModel("openai"),
    "--cd",
    ".",
    [
      "You are Codex on this workspace's Firecracker machine.",
      "The working directory is /workspace. Use the shell to inspect and change files there.",
      "Answer the user. If they ask for code changes, make them in the current directory.",
      "Do not inspect CODEX_HOME or authentication files.",
      "",
      formatGen2TurnPrompt(prompt, history),
    ].join("\n"),
  ];
}

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
}) {
  await requireReadyMember(input.workspaceId, input.userId);
  await requireGen2Chat(input.workspaceId, input.chatId);
  const history = await listGen2ChatMessages(input.chatId);
  const credential = await resolveGen2Codex(input.userId);

  // Only a subscription holds a seat. An API key has no one-turn-at-a-time
  // limit, so claiming one would invent a restriction the provider does not.
  let claimed = false;
  if (credential.credentialId) {
    try {
      await claimHostedCodexExecution(credential.credentialId);
      claimed = true;
    } catch (error) {
      if (
        !(error instanceof HostedCodexSubscriptionError) ||
        error.code !== "hosted_codex_busy"
      ) {
        throw error;
      }
    }
  }
  const execInput = {
    command: buildGen2CodexCommand(input.prompt, history),
    codexAuthCacheJson: credential.authCacheJson,
    idempotencyKey: input.idempotencyKey,
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
      await appendGen2ChatMessage({
        chatId: input.chatId,
        role: "user",
        body: input.prompt,
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
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      userId: input.userId,
    });
    return { sessionId };
  } catch (error) {
    if (claimed && credential.credentialId) {
      await releaseHostedCodexExecution(credential.credentialId);
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

export async function pollGen2AgentTurn(input: {
  workspaceId: string;
  userId: string;
  chatId?: string;
  sessionId: string;
  after: number;
}) {
  await requireGen2Member(input.workspaceId, input.userId);
  let result;
  try {
    result = await pollCodexExecInSandbox(
      input.workspaceId,
      input.sessionId,
      input.after,
    );
  } catch (error) {
    logEvent("error", "gen2.agent.poll_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    if (error instanceof OrchestratorError && error.status === 404) {
      await releasePersonalCodex(input.userId);
      throw new Gen2LifecycleError(
        "This Codex turn is no longer running. Send the prompt again.",
      );
    }
    throw new Gen2LifecycleError(describeGen2RuntimeFailure(error), 502);
  }

  const persisted = await recordGen2TurnChunks({
    sessionId: input.sessionId,
    chunks: result.chunks,
    exited: result.exited,
  });

  if (result.exited) {
    const hosted = await resolveHostedCodexSubscription({
      userId: input.userId,
      includeBusy: true,
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
        await releaseHostedCodexExecution(hosted.credential.id);
      }
    }
  }

  return {
    chunks: result.chunks,
    nextSequence: result.nextSequence,
    exited: result.exited,
    exitCode: result.exitCode,
    // Present only on the poll that ends the turn: the reply the server
    // already saved, so the client does not have to save it too.
    reply: persisted?.reply ?? null,
    persistedMessageId: persisted?.messageId ?? null,
  };
}

export async function cancelGen2AgentTurn(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
}) {
  await requireGen2Member(input.workspaceId, input.userId);
  try {
    await closeCodexExecInSandbox(input.workspaceId, input.sessionId);
  } catch (error) {
    if (!(error instanceof OrchestratorError && error.status === 404)) {
      throw new Gen2LifecycleError(describeGen2RuntimeFailure(error), 502);
    }
  } finally {
    await releasePersonalCodex(input.userId);
  }
}

async function releasePersonalCodex(userId: string) {
  const hosted = await resolveHostedCodexSubscription({
    userId,
    includeBusy: true,
  });
  if (hosted?.credential.id) {
    await releaseHostedCodexExecution(hosted.credential.id);
  }
}
