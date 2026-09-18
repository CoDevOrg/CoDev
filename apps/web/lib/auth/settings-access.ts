import "server-only";

import {
  checkWorkspaceRelation,
  requireWorkspacePermission,
  WorkspaceAccessError,
  type OpenFgaWorkspaceRelation,
  type WorkspaceAccessRole,
} from "./access";

export type OrganizationSettingsAction = "read" | "write";

export type OrganizationSettingsAccess = {
  role: WorkspaceAccessRole;
  canWrite: boolean;
  action: OrganizationSettingsAction;
};

export type OrganizationSettingsContext = OrganizationSettingsAccess & {
  workspace: {
    id: string;
    repository: string;
    repositoryVisibility: "private" | "public";
    status: string;
  };
};

export function isOrganizationSettingsAdmin(role: WorkspaceAccessRole) {
  return role === "owner";
}

/**
 * Authorizes reads and writes for shared settings.
 *
 * Maintainers are the only role allowed to change shared organization
 * settings; collaborators and viewers can still read them.
 */
export async function checkOrgSettingsAccess(
  userId: string,
  workspaceId: string,
  action: OrganizationSettingsAction,
): Promise<OrganizationSettingsAccess> {
  const membership = await requireWorkspacePermission(
    workspaceId,
    userId,
    "view",
  );
  const canWrite = isOrganizationSettingsAdmin(membership.role);

  if (action === "write") {
    if (!canWrite) {
      throw new WorkspaceAccessError(
        "Only workspace Maintainers can modify organization settings.",
      );
    }

    const fgaRelations: OpenFgaWorkspaceRelation[] =
      membership.role === "owner" ? ["owner"] : ["editor"];
    const allowed = await Promise.all(
      fgaRelations.map((relation) =>
        checkWorkspaceRelation(workspaceId, userId, relation),
      ),
    );
    if (!allowed.some(Boolean)) {
      throw new WorkspaceAccessError(
        "OpenFGA denied organization settings write access.",
      );
    }
  }

  return {
    role: membership.role,
    canWrite,
    action,
  };
}

export async function requireOrganizationSettingsAccess(
  userId: string,
  workspaceId: string,
  action: OrganizationSettingsAction = "read",
) {
  return checkOrgSettingsAccess(userId, workspaceId, action);
}

export async function requireOrganizationSettingsWrite(
  userId: string,
  workspaceId: string,
) {
  return requireOrganizationSettingsAccess(userId, workspaceId, "write");
}
