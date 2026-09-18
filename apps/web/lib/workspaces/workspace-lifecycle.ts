export function hasUnpublishedRuntimeChanges(
  integrationHeadSha: string,
  provisionedHeadSha: string | null,
  repositoryBaseSha: string,
) {
  return integrationHeadSha !== (provisionedHeadSha ?? repositoryBaseSha);
}

/**
 * Guards syncing a workspace to the latest default-branch commit. Only the
 * owner may sync, and only while the sandbox is stopped so the pinned snapshot
 * cannot desync from a live microVM. Returns the reason a sync is blocked, or
 * null when it is allowed.
 */
export function workspaceSyncBlockReason(
  role: string,
  status: string,
): "not_owner" | "not_stopped" | null {
  if (role !== "owner") return "not_owner";
  if (status !== "stopped") return "not_stopped";
  return null;
}
