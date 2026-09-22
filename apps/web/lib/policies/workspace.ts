import "server-only";

import { and, eq } from "drizzle-orm";

import type { Gen2WorkspaceRole } from "@codev/contracts";
import { schema } from "@codev/db";

import { Gen2AccessError } from "../gen2/errors";
import { getDatabase } from "../platform/database";
import {
  hasWorkspacePermission,
  permissionsForWorkspaceRole,
  type WorkspaceCapabilities,
  type WorkspacePermission,
} from "./permissions";

/** The server-resolved authority for one member in one workspace. */
export type WorkspaceAccess = {
  role: Gen2WorkspaceRole;
  capabilities: WorkspaceCapabilities;
};

/**
 * Looks up the role from the authoritative Gen 2 membership table. A client
 * must never supply a role or capability flag to establish this access.
 */
export async function getWorkspaceAccess(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceAccess | null> {
  const [membership] = await getDatabase()
    .select({ role: schema.gen2WorkspaceMembers.role })
    .from(schema.gen2WorkspaceMembers)
    .where(
      and(
        eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
        eq(schema.gen2WorkspaceMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) return null;

  return {
    role: membership.role,
    capabilities: permissionsForWorkspaceRole(membership.role),
  };
}

/**
 * Enforces one server-side capability for the current workspace member.
 * Permission denials are deliberately 403: routes can surface them through
 * the shared `withUser` error handling without interpreting roles.
 */
export async function requireWorkspacePermission(
  workspaceId: string,
  userId: string,
  permission: WorkspacePermission,
): Promise<WorkspaceAccess> {
  const access = await getWorkspaceAccess(workspaceId, userId);
  if (!access) {
    throw new Gen2AccessError("You don't have access to this workspace.", 403);
  }
  if (!hasWorkspacePermission(access.capabilities, permission)) {
    throw new Gen2AccessError(
      "You don't have permission to perform this action.",
      403,
    );
  }
  return access;
}
