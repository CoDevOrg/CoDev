import "server-only";

import { createHash } from "node:crypto";

import {
  createSupersetWorktree,
  listSupersetWorktrees,
} from "../runtime/orchestrator-superset-runtime";
import {
  describeSeatHolder,
  heartbeatCredentialSeat,
  releaseCredentialSeat,
  waitForCredentialSeat,
} from "../providers/credential-seat";
import {
  appendGen2ChatMessage,
  listGen2ChatMessages,
  requireGen2Chat,
} from "./chats";
import { buildGen2AgentCommand } from "./agent-command";
import { Gen2LifecycleError } from "./errors";
import { logEvent } from "../platform/observability";
import { resolveGen2Credential, type Gen2AgentProvider } from "./providers";
import { providerVendor } from "../providers/registry";
import { updateHostedCodexAuthCacheForUser } from "../providers/hosted-codex-subscription-credentials";
import {
  checkSupersetAgentRecovery,
  pollSupersetAgent,
  sendSupersetAgentInput,
  startSupersetAgent,
  stopSupersetAgent,
} from "./superset-agent-orchestrator-client";
import { isGen2SupersetAgentSessionsEnabled } from "./superset-agent-sessions-feature";
import {
  claimGen2SupersetRunLease,
  getGen2SupersetRunById,
  getGen2SupersetRunProgress,
  markGen2SupersetRunFailed,
  markGen2SupersetRunFinished,
  markGen2SupersetRunRecoveryRequired,
  markGen2SupersetRunStarted,
  markGen2SupersetRunStopping,
  registerGen2SupersetRun,
  releaseGen2SupersetRunLease,
  recordGen2SupersetRunProgress,
} from "./superset-runs";
import { createGen2Turn, recordGen2SupersetRunOutput } from "./turns";
import { toAgentExecChunks } from "./agent-output";
import { requireWorkspaceOwnerPlan } from "../billing/gate";
import { requireGen2Member } from "./workspaces";
import { requireGen2SupersetAgentAccess } from "./superset-agent-access";
import { filterSupersetAgentOutput } from "./superset-agent-output";

/**
 * The server-only CoDev runtime adapter docs/SUPERSET_AGENT_SESSION_PLAN.md
 * Phase 3 calls for: it wires Phase 1's durable run state machine
 * (`superset-runs.ts`) to the orchestrator client Phase 3 also adds
 * (`superset-agent-orchestrator-client.ts`). `startGen2SupersetAgentTurn`,
 * `pollGen2SupersetAgentTurn`, and `cancelGen2SupersetAgentTurn` below are
 * Phase 4: the flag-gated delegate `agent.ts`'s unchanged
 * `startGen2AgentTurn`/`pollGen2AgentTurn`/`cancelGen2AgentTurn` browser
 * contract calls into instead of the direct `codex exec` sandbox path.
 */

function requireEnabled() {
  if (!isGen2SupersetAgentSessionsEnabled()) {
    throw new Gen2LifecycleError(
      "Superset agent sessions are not enabled.",
      404,
    );
  }
}

async function requireOwnRun(workspaceId: string, runId: string) {
  const run = await getGen2SupersetRunById(runId);
  if (!run || run.workspaceId !== workspaceId) {
    throw new Gen2LifecycleError("Superset run not found.", 404);
  }
  return run;
}

async function requireTurnRun(
  workspaceId: string,
  userId: string,
  runId: string,
) {
  await requireGen2Member(workspaceId, userId);
  return requireOwnRun(workspaceId, runId);
}

type StartSessionInput = {
  workspaceId: string;
  userId: string;
  chatId?: string | null;
  worktreeId: string;
  command: string[];
  idempotencyKey: string;
  provider: Gen2AgentProvider;
};

export async function startGen2SupersetAgentSession(input: StartSessionInput) {
  return startSession(input, "persistent");
}

async function startSession(
  input: StartSessionInput,
  mode: "persistent" | "turn",
) {
  requireEnabled();
  if (mode === "persistent") {
    await requireGen2SupersetAgentAccess({
      action: "start",
      workspaceId: input.workspaceId,
      userId: input.userId,
    });
  } else {
    await requireGen2Member(input.workspaceId, input.userId);
  }
  await requireWorkspaceOwnerPlan(input.workspaceId);
  const provider = input.provider;
  const credential = await resolveGen2Credential(input.userId, provider);

  const registration = await registerGen2SupersetRun({
    workspaceId: input.workspaceId,
    chatId: input.chatId ?? null,
    createdBy: input.userId,
    worktreeId: input.worktreeId,
    provider: providerVendor(provider),
    connectionId: credential.credentialId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!registration.created) {
    // A retried start reattaches to the run already in flight instead of
    // claiming a second lease or starting a second Superset process.
    return registration;
  }

  // Only a subscription holds a seat -- an API key has no one-turn-at-a-time
  // limit, so claiming one would invent a restriction the provider does not.
  //
  // A busy seat used to be swallowed here and the run started anyway. It now
  // waits, and fails the run with what holds the seat if the wait runs out,
  // so the member is told the truth instead of two turns sharing one login.
  const claimed = Boolean(credential.credentialId);
  if (credential.credentialId) {
    const seat = await waitForCredentialSeat({
      credentialId: credential.credentialId,
      userId: input.userId,
      surface: "gen2",
      ref: registration.runId,
    });
    if (!seat.held) {
      await markGen2SupersetRunFailed({
        runId: registration.runId,
        workspaceId: input.workspaceId,
        lastError: "credential_busy",
        actorId: input.userId,
      });
      throw new Gen2LifecycleError(describeSeatHolder(seat.holder), 409);
    }
    await claimGen2SupersetRunLease({
      runId: registration.runId,
      workspaceId: input.workspaceId,
      actorId: input.userId,
    });
  }

  try {
    const started = await startSupersetAgent(input.workspaceId, {
      codevRunId: registration.runId,
      codevWorkspaceId: input.workspaceId,
      worktreeId: input.worktreeId,
      provider: providerVendor(provider),
      launchProfile: credential.launchProfile,
      command: input.command,
      idempotencyKey: input.idempotencyKey,
    });
    await markGen2SupersetRunStarted({
      runId: registration.runId,
      workspaceId: input.workspaceId,
      hostWorkspaceId: started.hostWorkspaceId,
      hostTerminalId: started.hostTerminalId,
      hostAgentSessionId: started.hostAgentSessionId,
      actorId: input.userId,
    });
    return { ...registration, status: "running" as const };
  } catch (error) {
    if (claimed && credential.credentialId) {
      await releaseCredentialSeat({
        credentialId: credential.credentialId,
        ref: registration.runId,
      });
      await releaseGen2SupersetRunLease({
        runId: registration.runId,
        workspaceId: input.workspaceId,
        actorId: input.userId,
      });
    }
    await markGen2SupersetRunFailed({
      runId: registration.runId,
      workspaceId: input.workspaceId,
      lastError: error instanceof Error ? error.message : "unknown",
      actorId: input.userId,
    });
    throw error;
  }
}

export async function sendGen2SupersetAgentInput(input: {
  workspaceId: string;
  userId: string;
  runId: string;
  data: string;
}) {
  requireEnabled();
  const run = await requireGen2SupersetAgentAccess({
    action: "input",
    workspaceId: input.workspaceId,
    userId: input.userId,
    runId: input.runId,
  });
  await requireWorkspaceOwnerPlan(input.workspaceId);
  if (!run.hostAgentSessionId) {
    throw new Gen2LifecycleError("This run has not started yet.", 409);
  }
  await sendSupersetAgentInput(
    input.workspaceId,
    run.hostAgentSessionId,
    input.data,
  );
}

type PollSessionInput = {
  workspaceId: string;
  userId: string;
  runId: string;
  after: number;
};

async function captureRefreshedCredential(
  run: { connectionId: string | null; createdBy: string; provider: string },
  refreshedCodexAuthCache: string | undefined,
) {
  if (
    !refreshedCodexAuthCache ||
    !run.connectionId ||
    run.provider !== "openai"
  ) {
    return;
  }
  await updateHostedCodexAuthCacheForUser({
    credentialId: run.connectionId,
    userId: run.createdBy,
    authCacheJson: refreshedCodexAuthCache,
  });
}

function exitReason(exitCode: number | null) {
  if (exitCode === 0) return "completed";
  return exitCode === null ? "exit_unknown" : `exit_code:${exitCode}`;
}

export async function pollGen2SupersetAgentSession(input: PollSessionInput) {
  return pollSession(input, "persistent");
}

async function pollSession(
  input: PollSessionInput,
  mode: "persistent" | "turn",
) {
  requireEnabled();
  const run =
    mode === "persistent"
      ? await requireGen2SupersetAgentAccess({
          action: "poll",
          workspaceId: input.workspaceId,
          userId: input.userId,
          runId: input.runId,
        })
      : await requireTurnRun(input.workspaceId, input.userId, input.runId);
  if (!run.hostAgentSessionId) {
    throw new Gen2LifecycleError("This run has not started yet.", 409);
  }

  const result = await pollSupersetAgent(
    input.workspaceId,
    run.hostAgentSessionId,
    input.after,
  );

  // A changed terminal snapshot proves the agent is working. An empty browser
  // poll does not extend a paid credential seat.
  if (run.leaseClaimed && run.connectionId && result.chunks.length > 0) {
    await heartbeatCredentialSeat({
      credentialId: run.connectionId,
      ref: run.id,
    });
  }

  if (result.exited) {
    await captureRefreshedCredential(run, result.refreshedCodexAuthCache);
    await markGen2SupersetRunFinished({
      runId: run.id,
      workspaceId: input.workspaceId,
      exitReason: exitReason(result.exitCode),
      actorId: input.userId,
    });
    if (run.leaseClaimed && run.connectionId) {
      await releaseCredentialSeat({
        credentialId: run.connectionId,
        ref: run.id,
      });
    }
    await releaseGen2SupersetRunLease({
      runId: run.id,
      workspaceId: input.workspaceId,
      actorId: input.userId,
    });
  }

  const { refreshedCodexAuthCache: _, ...safeResult } = result;
  return safeResult;
}

type CancelSessionInput = {
  workspaceId: string;
  userId: string;
  runId: string;
};

export async function cancelGen2SupersetAgentSession(
  input: CancelSessionInput,
) {
  return cancelSession(input, "persistent");
}

async function cancelSession(
  input: CancelSessionInput,
  mode: "persistent" | "turn",
) {
  requireEnabled();
  const run =
    mode === "persistent"
      ? await requireGen2SupersetAgentAccess({
          action: "cancel",
          workspaceId: input.workspaceId,
          userId: input.userId,
          runId: input.runId,
        })
      : await requireTurnRun(input.workspaceId, input.userId, input.runId);

  await markGen2SupersetRunStopping({
    runId: run.id,
    workspaceId: input.workspaceId,
    actorId: input.userId,
  });
  let cancelled = false;
  try {
    if (run.hostAgentSessionId) {
      const stopped = await stopSupersetAgent(
        input.workspaceId,
        run.hostAgentSessionId,
      );
      await captureRefreshedCredential(run, stopped?.refreshedCodexAuthCache);
    }
    cancelled = true;
  } catch (error) {
    await markGen2SupersetRunRecoveryRequired({
      runId: run.id,
      workspaceId: input.workspaceId,
      lastError: "Host could not confirm agent cancellation.",
      actorId: input.userId,
    });
    throw error;
  } finally {
    if (run.leaseClaimed && run.connectionId) {
      await releaseCredentialSeat({
        credentialId: run.connectionId,
        ref: run.id,
      });
    }
    await releaseGen2SupersetRunLease({
      runId: run.id,
      workspaceId: input.workspaceId,
      actorId: input.userId,
    });
    if (cancelled) {
      await markGen2SupersetRunFinished({
        runId: run.id,
        workspaceId: input.workspaceId,
        exitReason: "cancelled",
        actorId: input.userId,
      });
    }
  }
}

/**
 * Phase 5's host-restart reconciliation, exposed here since Phase 3 already
 * adds the `/agents/:id/recovery` route this calls. A run that cannot be
 * verified live moves to `recovery_required` rather than being silently
 * relaunched with a potentially stale credential profile.
 */
export async function reconcileGen2SupersetAgentSession(input: {
  workspaceId: string;
  userId: string;
  runId: string;
}) {
  requireEnabled();
  const run = await requireGen2SupersetAgentAccess({
    action: "recover",
    workspaceId: input.workspaceId,
    userId: input.userId,
    runId: input.runId,
  });
  if (!run.hostAgentSessionId) {
    return { adoptable: false as const };
  }

  const recovery = await checkSupersetAgentRecovery(
    input.workspaceId,
    run.hostAgentSessionId,
  );
  await captureRefreshedCredential(run, recovery.refreshedCodexAuthCache);
  if (!recovery.adoptable) {
    await markGen2SupersetRunRecoveryRequired({
      runId: run.id,
      workspaceId: input.workspaceId,
      lastError:
        recovery.status === "exited"
          ? "Agent process exited while host was unreachable."
          : "Host could not verify the run after a restart.",
      actorId: input.userId,
    });
  } else {
    // If adoptable and actively running, ensure the credential seat lease is renewed
    if (run.leaseClaimed && run.connectionId) {
      await heartbeatCredentialSeat({
        credentialId: run.connectionId,
        ref: run.id,
      });
    }
  }
  const { refreshedCodexAuthCache: _, ...safeRecovery } = recovery;
  return safeRecovery;
}

/**
 * One worktree per start idempotency key. A retry gets the same checkout;
 * independent agents in the same chat get different checkouts.
 */
function agentWorktreeIdForStart(idempotencyKey: string) {
  return `agent-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40)}`;
}

async function ensureGen2SupersetAgentWorktree(
  workspaceId: string,
  idempotencyKey: string,
) {
  const worktreeId = agentWorktreeIdForStart(idempotencyKey);
  const existing = await listSupersetWorktrees(workspaceId);
  if (existing.some((worktree) => worktree.worktreeId === worktreeId)) {
    return worktreeId;
  }
  try {
    await createSupersetWorktree(workspaceId, {
      worktreeId,
      branch: `codev/${worktreeId}`,
      baseRef: "HEAD",
    });
  } catch (error) {
    // Two retries racing to create the same agent worktree: the loser's
    // `git worktree add` fails, but the worktree it wanted now exists anyway.
    const retried = await listSupersetWorktrees(workspaceId);
    if (!retried.some((worktree) => worktree.worktreeId === worktreeId)) {
      throw error;
    }
  }
  return worktreeId;
}

/**
 * Phase 4: what `startGen2AgentTurn` in `agent.ts` delegates to when
 * `CODEV_SUPERSET_AGENT_SESSIONS_ENABLED` is set, in place of
 * `startCodexExecInSandbox`. Same browser contract (`{ sessionId }`) -- the
 * durable run's own id stands in for the sandbox session id the direct path
 * returns, and `pollGen2SupersetAgentTurn`/`cancelGen2SupersetAgentTurn`
 * accept it back the same way.
 */
export async function startGen2SupersetAgentTurn(input: {
  workspaceId: string;
  userId: string;
  chatId: string;
  prompt: string;
  idempotencyKey: string;
  provider: Gen2AgentProvider;
  worktreeId?: string | undefined;
  model?: string | undefined;
}) {
  requireEnabled();
  await requireGen2Member(input.workspaceId, input.userId);
  await requireWorkspaceOwnerPlan(input.workspaceId);
  await requireGen2Chat(input.workspaceId, input.chatId);
  const history = await listGen2ChatMessages(input.chatId);
  const worktreeId =
    input.worktreeId ??
    (await ensureGen2SupersetAgentWorktree(
      input.workspaceId,
      input.idempotencyKey,
    ));
  const provider = input.provider;
  const command = buildGen2AgentCommand(
    provider,
    input.prompt,
    history,
    input.model,
  );

  const session = await startSession(
    {
      workspaceId: input.workspaceId,
      userId: input.userId,
      chatId: input.chatId,
      worktreeId,
      command,
      provider,
      idempotencyKey: input.idempotencyKey,
    },
    "turn",
  );

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
  // row, so the reply survives the browser going away mid-turn. Matches
  // `startGen2AgentTurn`'s `createGen2Turn` call in agent.ts; safe to repeat
  // on a retried start because of `onConflictDoNothing`.
  await createGen2Turn({
    sessionId: session.runId,
    provider,
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    userId: input.userId,
  });
  return { sessionId: session.runId };
}

/** Start a persistent run through the CoDev facade with a server-built command. */
export async function startGen2SupersetPersistentAgent(input: {
  workspaceId: string;
  userId: string;
  chatId: string;
  prompt: string;
  idempotencyKey: string;
  provider: Gen2AgentProvider;
  worktreeId?: string | undefined;
  model?: string | undefined;
}) {
  requireEnabled();
  await requireGen2Chat(input.workspaceId, input.chatId);
  const history = await listGen2ChatMessages(input.chatId);
  const worktreeId =
    input.worktreeId ??
    (await ensureGen2SupersetAgentWorktree(
      input.workspaceId,
      input.idempotencyKey,
    ));
  const session = await startSession(
    {
      workspaceId: input.workspaceId,
      userId: input.userId,
      chatId: input.chatId,
      worktreeId,
      command: buildGen2AgentCommand(
        input.provider,
        input.prompt,
        history,
        input.model,
      ),
      provider: input.provider,
      idempotencyKey: input.idempotencyKey,
    },
    "persistent",
  );
  return { runId: session.runId, status: session.status };
}

function latestSnapshot(chunks: { sequence: number; data: string }[]) {
  return chunks.reduce<{ sequence: number; data: string } | null>(
    (latest, chunk) =>
      !latest || chunk.sequence > latest.sequence ? chunk : latest,
    null,
  );
}

export async function pollGen2SupersetAgentProgress(input: PollSessionInput) {
  const result = await pollSession(input, "persistent");
  const snapshot = latestSnapshot(result.chunks);
  if (snapshot) {
    await recordGen2SupersetRunProgress({
      runId: input.runId,
      workspaceId: input.workspaceId,
      output: filterSupersetAgentOutput(snapshot.data),
    });
  }
  return getGen2SupersetAgentProgress(input);
}

export async function getGen2SupersetAgentProgress(input: PollSessionInput) {
  const run = await requireGen2SupersetAgentAccess({
    action: "progress",
    workspaceId: input.workspaceId,
    userId: input.userId,
    runId: input.runId,
  });
  const progress = await getGen2SupersetRunProgress({
    runId: run.id,
    workspaceId: input.workspaceId,
  });
  return {
    chunks:
      input.after < progress.sequence
        ? [{ sequence: progress.sequence, text: progress.output }]
        : [],
    nextSequence: progress.sequence,
    status: run.status,
    exited: ["finished", "failed"].includes(run.status),
    exitCode: run.exitReason === "completed" ? 0 : null,
  };
}

/**
 * Phase 4: `pollGen2AgentTurn`'s Superset delegate. `input.sessionId` is the
 * durable run id `startGen2SupersetAgentTurn` returned.
 */
export async function pollGen2SupersetAgentTurn(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
  after: number;
}) {
  requireEnabled();
  const result = await pollSession(
    {
      workspaceId: input.workspaceId,
      userId: input.userId,
      runId: input.sessionId,
      after: input.after,
    },
    "turn",
  );

  const persisted = await recordGen2SupersetRunOutput({
    sessionId: input.sessionId,
    chunks: result.chunks,
    exited: result.exited,
    exitCode: result.exitCode,
  });

  return {
    chunks: toAgentExecChunks(result.chunks),
    nextSequence: result.nextSequence,
    exited: result.exited,
    exitCode: result.exitCode,
    reply: persisted?.reply ?? null,
    persistedMessageId: persisted?.messageId ?? null,
  };
}

/**
 * Phase 4: `cancelGen2AgentTurn`'s Superset delegate.
 */
export async function cancelGen2SupersetAgentTurn(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
}) {
  requireEnabled();
  await cancelSession(
    {
      workspaceId: input.workspaceId,
      userId: input.userId,
      runId: input.sessionId,
    },
    "turn",
  );
}
