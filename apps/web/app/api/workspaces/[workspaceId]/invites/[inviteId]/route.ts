import { apiError, getApiUser } from "@/lib/api";
import { revokeWorkspaceInvite } from "@/lib/workspaces";

export async function DELETE(
  _request: Request,
  context: {
    params: Promise<{ workspaceId: string; inviteId: string }>;
  },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const { workspaceId, inviteId } = await context.params;
    await revokeWorkspaceInvite(workspaceId, inviteId, user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
