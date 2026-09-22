import "server-only";

import { Gen2AccessError } from "../gen2/errors";
import { requireWorkspacePermission, type WorkspaceAccess } from "./workspace";

/** The only provider information a different workspace member may receive. */
export type RedactedConnectionStatus = {
  connected: boolean;
};

/**
 * Authorizes a member to see a provider's redacted connected/not-connected
 * state. It intentionally does not return provider identity, token metadata,
 * or credential material.
 */
export function requireConnectionStatusView(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceAccess> {
  return requireWorkspacePermission(
    workspaceId,
    userId,
    "connection.viewStatus",
  );
}

/**
 * Authorizes management of a personal provider connection. Workspace owners
 * do not inherit control of another member's connection: the connection owner
 * must be the signed-in member.
 */
export async function requireOwnConnectionManagement(input: {
  workspaceId: string;
  userId: string;
  connectionOwnerId: string;
}): Promise<WorkspaceAccess> {
  const access = await requireWorkspacePermission(
    input.workspaceId,
    input.userId,
    "connection.manageOwn",
  );
  if (input.connectionOwnerId !== input.userId) {
    throw new Gen2AccessError(
      "You can only manage your own provider connection.",
      403,
    );
  }
  return access;
}

export function redactConnectionStatus(
  connected: boolean,
): RedactedConnectionStatus {
  return { connected };
}
