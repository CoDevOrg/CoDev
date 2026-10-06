import "server-only";

import { Gen2LifecycleError } from "./errors";
import { requireGen2SupersetAgentAccess } from "./superset-agent-access";
import { listGen2SupersetRuns } from "./superset-runs";
import type { getGen2SupersetRunById } from "./superset-runs";

type Gen2SupersetRun = NonNullable<
  Awaited<ReturnType<typeof getGen2SupersetRunById>>
>;

function toSafeSession(run: Gen2SupersetRun) {
  return {
    id: run.id,
    chatId: run.chatId,
    createdBy: run.createdBy,
    worktreeId: run.worktreeId,
    provider: run.provider,
    status: run.status,
    recoveryCount: run.recoveryCount,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

/** Shared session metadata only; host ids, credential ids, and output stay server-side. */
export async function listGen2SupersetAgentRuns(
  workspaceId: string,
  userId: string,
) {
  await requireGen2SupersetAgentAccess({ action: "list", workspaceId, userId });
  const runs = await listGen2SupersetRuns(workspaceId);
  return runs.map(toSafeSession);
}

/** Inspect one persisted session without returning host or raw output details. */
export async function getGen2SupersetAgentRun(
  workspaceId: string,
  userId: string,
  runId: string,
) {
  const run = await requireGen2SupersetAgentAccess({
    action: "inspect",
    workspaceId,
    userId,
    runId,
  });
  if (!run) throw new Gen2LifecycleError("Superset run not found.", 404);
  return toSafeSession(run);
}
