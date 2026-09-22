import "server-only";

import { requireWorkspacePermission, type WorkspaceAccess } from "./workspace";

/** Allows a member to read the shared chat history and turn activity. */
export function requireContextView(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceAccess> {
  return requireWorkspacePermission(workspaceId, userId, "context.view");
}

/**
 * Allows a member to include the shared transcript in a new agent turn.
 * This is separate from viewing it so a future policy can make the distinction
 * without changing callers.
 */
export function requireContextInTurn(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceAccess> {
  return requireWorkspacePermission(
    workspaceId,
    userId,
    "context.includeInTurn",
  );
}
