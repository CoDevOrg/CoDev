import "server-only";

import { requireGen2SupersetAgentAccess } from "./superset-agent-access";
import { listActiveGen2SupersetRuns } from "./superset-runs";

/** Shared metadata only; host ids, credential ids, and errors stay server-side. */
export async function listGen2SupersetAgentRuns(
  workspaceId: string,
  userId: string,
) {
  const member = await requireGen2SupersetAgentAccess({
    action: "list",
    workspaceId,
    userId,
  });
  const runs = await listActiveGen2SupersetRuns(workspaceId);
  return runs.map((run) => ({
    id: run.id,
    chatId: run.chatId,
    createdBy: run.createdBy,
    worktreeId: run.worktreeId,
    provider: run.provider,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    canInput: run.createdBy === userId && member?.role !== "viewer",
    canCancel: run.createdBy === userId || member?.role === "owner",
    canRecover: run.createdBy === userId && member?.role !== "viewer",
  }));
}
