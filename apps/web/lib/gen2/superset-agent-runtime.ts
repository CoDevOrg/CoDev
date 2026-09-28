import "server-only";

import {
  createSupersetWorktree,
  listSupersetWorktrees,
} from "../runtime/orchestrator-superset-runtime";
import {
  HostedCodexSubscriptionError,
  claimHostedCodexExecution,
  releaseHostedCodexExecution,
} from "../providers/hosted-codex-subscription-credentials";
import {
  appendGen2ChatMessage,
  listGen2ChatMessages,
  requireGen2Chat,
} from "./chats";
import { buildGen2CodexCommand } from "./codex-command";
import { Gen2LifecycleError } from "./errors";
import { logEvent } from "../platform/observability";
import { resolveGen2Codex } from "./providers";
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
  markGen2SupersetRunFailed,
  markGen2SupersetRunFinished,
  markGen2SupersetRunRecoveryRequired,
  markGen2SupersetRunStarted,
  markGen2SupersetRunStopping,
  registerGen2SupersetRun,
  releaseGen2SupersetRunLease,
} from "./superset-runs";
import { createGen2Turn, recordGen2SupersetRunOutput } from "./turns";
import { toCodexExecChunks } from "./codex-output";
import { requireGen2Member } from "./workspaces";

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

export async function startGen2SupersetAgentSession(input: {
  workspaceId: string;
  userId: string;
  chatId?: string | null;
  worktreeId: string;
  command: string[];
  idempotencyKey: string;
}) {
  requireEnabled();
  await requireGen2Member(input.workspaceId, input.userId);
  const credential = await resolveGen2Codex(input.userId);

  const registration = await registerGen2SupersetRun({
    workspaceId: input.workspaceId,
    chatId: input.chatId ?? null,
    createdBy: input.userId,
    worktreeId: input.worktreeId,
    provider: "openai",
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
  let claimed = false;
  if (credential.credentialId) {
    try {
      await claimHostedCodexExecution(credential.credentialId);
      claimed = true;
      await claimGen2SupersetRunLease({
        runId: registration.runId,
        workspaceId: input.workspaceId,
        actorId: input.userId,
      });
    } catch (error) {
      if (
        !(error instanceof HostedCodexSubscriptionError) ||
        error.code !== "hosted_codex_busy"
      ) {
        throw error;
      }
    }
  }

  try {
    const started = await startSupersetAgent(input.workspaceId, {
      worktreeId: input.worktreeId,
      provider: "openai",
      codexAuthCacheJson: credential.authCacheJson,
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
      await releaseHostedCodexExecution(credential.credentialId);
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
  await requireGen2Member(input.workspaceId, input.userId);
  const run = await requireOwnRun(input.workspaceId, input.runId);
  if (!run.hostAgentSessionId) {
    throw new Gen2LifecycleError("This run has not started yet.", 409);
  }
  await sendSupersetAgentInput(
    input.workspaceId,
    run.hostAgentSessionId,
    input.data,
  );
}

export async function pollGen2SupersetAgentSession(input: {
  workspaceId: string;
  userId: string;
  runId: string;
  after: number;
}) {
  requireEnabled();
  await requireGen2Member(input.workspaceId, input.userId);
  const run = await requireOwnRun(input.workspaceId, input.runId);
  if (!run.hostAgentSessionId) {
    throw new Gen2LifecycleError("This run has not started yet.", 409);
  }

  const result = await pollSupersetAgent(
    input.workspaceId,
    run.hostAgentSessionId,
    input.after,
  );

  if (result.exited) {
    await markGen2SupersetRunFinished({
      runId: run.id,
      workspaceId: input.workspaceId,
      exitReason:
        result.exitCode === 0 ? "completed" : `exit_code:${result.exitCode}`,
      actorId: input.userId,
    });
    if (run.leaseClaimed && run.connectionId) {
      await releaseHostedCodexExecution(run.connectionId);
    }
    await releaseGen2SupersetRunLease({
      runId: run.id,
      workspaceId: input.workspaceId,
      actorId: input.userId,
    });
  }

  return result;
}

export async function cancelGen2SupersetAgentSession(input: {
  workspaceId: string;
  userId: string;
  runId: string;
}) {
  requireEnabled();
  await requireGen2Member(input.workspaceId, input.userId);
  const run = await requireOwnRun(input.workspaceId, input.runId);

  await markGen2SupersetRunStopping({
    runId: run.id,
    workspaceId: input.workspaceId,
    actorId: input.userId,
  });
  try {
    if (run.hostAgentSessionId) {
      await stopSupersetAgent(input.workspaceId, run.hostAgentSessionId);
    }
  } finally {
    if (run.leaseClaimed && run.connectionId) {
      await releaseHostedCodexExecution(run.connectionId);
    }
    await releaseGen2SupersetRunLease({
      runId: run.id,
      workspaceId: input.workspaceId,
      actorId: input.userId,
    });
    await markGen2SupersetRunFinished({
      runId: run.id,
      workspaceId: input.workspaceId,
      exitReason: "cancelled",
      actorId: input.userId,
    });
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
  await requireGen2Member(input.workspaceId, input.userId);
  const run = await requireOwnRun(input.workspaceId, input.runId);
  if (!run.hostAgentSessionId) {
    return { adoptable: false as const };
  }

  const recovery = await checkSupersetAgentRecovery(
    input.workspaceId,
    run.hostAgentSessionId,
  );
  if (!recovery.adoptable) {
    await markGen2SupersetRunRecoveryRequired({
      runId: run.id,
      workspaceId: input.workspaceId,
      lastError: "Host could not verify the run after a restart.",
      actorId: input.userId,
    });
  }
  return recovery;
}

/**
 * One worktree per chat, so two members' agents in two different chats never
 * collide on the same checkout, matching Plan Phase 4 step 2 ("concurrent
 * independent agents receive distinct worktrees"). Idempotent: a chat's
 * worktree is created once and reused by every later turn in that chat.
 */
function agentWorktreeIdForChat(chatId: string) {
  return `agent-${chatId.replace(/-/g, "")}`.slice(0, 64);
}

async function ensureGen2SupersetAgentWorktree(
  workspaceId: string,
  chatId: string,
) {
  const worktreeId = agentWorktreeIdForChat(chatId);
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
    // Two turns racing to create the same chat's first worktree: the loser's
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
}) {
  requireEnabled();
  await requireGen2Member(input.workspaceId, input.userId);
  await requireGen2Chat(input.workspaceId, input.chatId);
  const history = await listGen2ChatMessages(input.chatId);
  const worktreeId = await ensureGen2SupersetAgentWorktree(
    input.workspaceId,
    input.chatId,
  );
  const command = buildGen2CodexCommand(input.prompt, history);

  const session = await startGen2SupersetAgentSession({
    workspaceId: input.workspaceId,
    userId: input.userId,
    chatId: input.chatId,
    worktreeId,
    command,
    idempotencyKey: input.idempotencyKey,
  });

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
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    userId: input.userId,
  });
  return { sessionId: session.runId };
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
  const result = await pollGen2SupersetAgentSession({
    workspaceId: input.workspaceId,
    userId: input.userId,
    runId: input.sessionId,
    after: input.after,
  });

  const persisted = await recordGen2SupersetRunOutput({
    sessionId: input.sessionId,
    chunks: result.chunks,
    exited: result.exited,
  });

  return {
    chunks: toCodexExecChunks(result.chunks),
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
  await cancelGen2SupersetAgentSession({
    workspaceId: input.workspaceId,
    userId: input.userId,
    runId: input.sessionId,
  });
}
