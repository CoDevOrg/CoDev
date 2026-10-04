import "server-only";

import {
  heartbeatCredentialSeat,
  releaseCredentialSeat,
} from "../providers/credential-seat";
import { Gen2LifecycleError } from "./errors";
import {
  captureRefreshedSupersetCredential,
  supersetAgentExitReason,
} from "./superset-agent-lifecycle";
import { filterSupersetAgentOutput } from "./superset-agent-output";
import { pollSupersetAgent } from "./superset-agent-orchestrator-client";
import { isGen2SupersetAgentSessionsEnabled } from "./superset-agent-sessions-feature";
import {
  getGen2SupersetRunById,
  markGen2SupersetRunFinished,
  markGen2SupersetRunRecoveryRequired,
  recordGen2SupersetRunProgress,
  releaseGen2SupersetRunLease,
} from "./superset-runs";
import { recordGen2SupersetRunOutput } from "./turns";

function requireEnabled() {
  if (!isGen2SupersetAgentSessionsEnabled()) {
    throw new Gen2LifecycleError(
      "Superset agent sessions are not enabled.",
      404,
    );
  }
}

function latestSnapshot(chunks: { sequence: number; data: string }[]) {
  return chunks.reduce<{ sequence: number; data: string } | null>(
    (latest, chunk) =>
      !latest || chunk.sequence > latest.sequence ? chunk : latest,
    null,
  );
}

async function persistMonitorOutput(
  run: NonNullable<Awaited<ReturnType<typeof getGen2SupersetRunById>>>,
  result: Awaited<ReturnType<typeof pollSupersetAgent>>,
) {
  if (run.chatId) {
    await recordGen2SupersetRunOutput({
      sessionId: run.id,
      chunks: result.chunks,
      exited: result.exited,
      exitCode: result.exitCode,
    });
    return;
  }
  const snapshot = latestSnapshot(result.chunks);
  if (!snapshot) return;
  await recordGen2SupersetRunProgress({
    runId: run.id,
    workspaceId: run.workspaceId,
    output: filterSupersetAgentOutput(snapshot.data),
  });
}

async function finishMonitoredRun(
  run: NonNullable<Awaited<ReturnType<typeof getGen2SupersetRunById>>>,
  refreshedCodexAuthCache: string | undefined,
  exitCode: number | null,
) {
  await captureRefreshedSupersetCredential(run, refreshedCodexAuthCache);
  await markGen2SupersetRunFinished({
    runId: run.id,
    workspaceId: run.workspaceId,
    exitReason: supersetAgentExitReason(exitCode),
    actorId: run.createdBy,
  });
  if (run.leaseClaimed && run.connectionId) {
    await releaseCredentialSeat({
      credentialId: run.connectionId,
      ref: run.id,
    });
  }
  await releaseGen2SupersetRunLease({
    runId: run.id,
    workspaceId: run.workspaceId,
    actorId: run.createdBy,
  });
}

/** Polls a live launch on the server, independent of browser activity. */
export async function monitorGen2SupersetAgentRun(input: {
  runId: string;
  after: number;
}) {
  requireEnabled();
  const run = await getGen2SupersetRunById(input.runId);
  if (
    !run ||
    ["finished", "failed", "recovery_required"].includes(run.status)
  ) {
    return { nextSequence: input.after, exited: true };
  }
  if (!run.hostAgentSessionId) {
    throw new Gen2LifecycleError("This run has not started yet.", 409);
  }
  const result = await pollSupersetAgent(
    run.workspaceId,
    run.hostAgentSessionId,
    input.after,
  );
  if (run.leaseClaimed && run.connectionId && !result.exited) {
    await heartbeatCredentialSeat({
      credentialId: run.connectionId,
      ref: run.id,
    });
  }
  await persistMonitorOutput(run, result);
  if (result.exited) {
    await finishMonitoredRun(
      run,
      result.refreshedCodexAuthCache,
      result.exitCode,
    );
  }
  return { nextSequence: result.nextSequence, exited: result.exited };
}

/** Mark an unverified workflow failure for member-visible recovery. */
export async function failGen2SupersetAgentMonitor(runId: string) {
  const run = await getGen2SupersetRunById(runId);
  if (!run) return;
  await markGen2SupersetRunRecoveryRequired({
    runId: run.id,
    workspaceId: run.workspaceId,
    lastError: "The server could no longer monitor this agent.",
    actorId: run.createdBy,
  });
}
