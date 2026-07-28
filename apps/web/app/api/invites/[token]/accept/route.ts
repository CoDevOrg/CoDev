import { apiError, getApiUser } from "@/lib/api";
import { acceptWorkspaceInvite } from "@/lib/workspaces";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const { token } = await context.params;
    const workspaceId = await acceptWorkspaceInvite(token, user.id);
    return Response.json({ workspaceId });
  } catch (error) {
    return apiError(error);
  }
}
