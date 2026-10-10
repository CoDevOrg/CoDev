import type { Gen2WorkspaceMember, Gen2WorkspaceRole } from "@codev/contracts";

/**
 * The member requests the Share dialog and the agent's invite card both
 * make. They never touch the share link: inviting someone must not rotate
 * the link a group already uses.
 */
export type WorkspaceMembersResult = {
  ok: boolean;
  status: number;
  members: Gen2WorkspaceMember[] | null;
  ownerId: string | null;
  error: string | null;
};

async function membersRequest(
  workspaceId: string,
  init?: RequestInit,
): Promise<WorkspaceMembersResult> {
  const response = await fetch(
    `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/members`,
    init,
  );
  const data = (await response.json().catch(() => ({}))) as {
    members?: Gen2WorkspaceMember[];
    ownerId?: string;
    error?: string;
  };
  return {
    ok: response.ok && Array.isArray(data.members),
    status: response.status,
    members: Array.isArray(data.members) ? data.members : null,
    ownerId: data.ownerId ?? null,
    error: data.error ?? null,
  };
}

/** Everyone with access. Throws only when CoDev cannot be reached. */
export function listWorkspaceMembers(workspaceId: string) {
  return membersRequest(workspaceId);
}

/** Adds one person by email or username. Throws only when CoDev cannot be reached. */
export function addWorkspaceMember(
  workspaceId: string,
  emailOrLogin: string,
  role: Gen2WorkspaceRole,
) {
  return membersRequest(workspaceId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ emailOrLogin, role }),
  });
}
