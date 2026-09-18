import { withUser } from "@/lib/http/api-route";
import { revokeWorkspaceInvite } from "@/lib/workspaces/workspaces";

export const DELETE = withUser<{ workspaceId: string; inviteId: string }>(
  async ({ user, params: { workspaceId, inviteId } }) => {
    await revokeWorkspaceInvite(workspaceId, inviteId, user.id);
    return new Response(null, { status: 204 });
  },
);
