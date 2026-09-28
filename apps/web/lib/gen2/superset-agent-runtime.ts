import "server-only";

import {
  HostedCodexSubscriptionError,
  claimHostedCodexExecution,
  releaseHostedCodexExecution,
} from "../providers/hosted-codex-subscription-credentials";
import { Gen2LifecycleError } from "./errors";
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
import { requireGen2Member } from "./workspaces";

/**
 * The server-only CoDev runtime adapter docs/SUPERSET_AGENT_SESSION_PLAN.md
 * Phase 3 calls for: it wires Phase 1's durable run state machine
 * (`superset-runs.ts`) to the orchestrator client Phase 3 also adds
 * (`superset-agent-orchestrator-client.ts`, itself provisional until the
 * matching Rust routes exist). Not called from any route yet -- wiring a
 * browser-facing path to this is Phase 4/6, not this module.
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
