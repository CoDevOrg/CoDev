import type { Gen2WorkspaceRole } from "@codev/contracts";

/**
 * The questions server-side workspace code asks before it performs an action.
 * Roles are only presets for these capabilities; callers must never branch on
 * a role directly.
 */
export const workspacePermissionNames = [
  "workspace.view",
  "workspace.editFiles",
  "workspace.useTerminal",
  "instance.start",
  "instance.stop",
  "agent.run",
  "agent.cancelOwn",
  "agent.cancelAny",
  "context.view",
  "context.includeInTurn",
  "member.invite",
  "member.changeRole",
  "member.remove",
  "workspace.managePolicy",
  "connection.manageOwn",
  "connection.viewStatus",
] as const;

export type WorkspacePermission = (typeof workspacePermissionNames)[number];

/** Resolved permissions are capability flags, not a role exposed as authority. */
export type WorkspaceCapabilities = Record<WorkspacePermission, boolean>;

const editorPermissions: readonly WorkspacePermission[] = [
  "workspace.view",
  "workspace.editFiles",
  "workspace.useTerminal",
  "instance.start",
  "agent.run",
  "agent.cancelOwn",
  "context.view",
  "context.includeInTurn",
  "connection.manageOwn",
];

const viewerPermissions: readonly WorkspacePermission[] = [
  "workspace.view",
  "context.view",
  // Credentials are personal, so read-only workspace members may manage
  // their own provider connection without gaining workspace-wide visibility.
  "connection.manageOwn",
];

// Only workspace owners receive connection.viewStatus, which authorizes the
// aggregate member-readiness view. All member roles can manage their own
// personal connection, never another member's credentials.

/**
 * Resolves the fixed capability set for a workspace role. This is deliberately
 * pure so policy rules can be exercised without a database or request context.
 */
export function permissionsForWorkspaceRole(
  role: Gen2WorkspaceRole,
): WorkspaceCapabilities {
  switch (role) {
    case "owner":
      return resolvePermissions(workspacePermissionNames);
    case "editor":
      return resolvePermissions(editorPermissions);
    case "viewer":
      return resolvePermissions(viewerPermissions);
  }
}

export function hasWorkspacePermission(
  capabilities: WorkspaceCapabilities,
  permission: WorkspacePermission,
) {
  return capabilities[permission];
}

function resolvePermissions(
  granted: readonly WorkspacePermission[],
): WorkspaceCapabilities {
  return Object.fromEntries(
    workspacePermissionNames.map((permission) => [
      permission,
      granted.includes(permission),
    ]),
  ) as WorkspaceCapabilities;
}
