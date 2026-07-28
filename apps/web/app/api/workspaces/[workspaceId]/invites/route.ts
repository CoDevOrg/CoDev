import { apiError, getApiUser } from "@/lib/api";
import { createWorkspaceInvite } from "@/lib/workspaces";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const { workspaceId } = await context.params;
    const invite = await createWorkspaceInvite(workspaceId, user.id);
    const origin = new URL(request.url).origin;
    return Response.json({
      inviteId: invite.id,
      inviteUrl: `${origin}/invites/${invite.token}`,
      expiresInHours: 24,
    });
  } catch (error) {
    return apiError(error);
  }
}
