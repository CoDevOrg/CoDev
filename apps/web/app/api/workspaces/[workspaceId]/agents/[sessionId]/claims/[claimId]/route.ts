import { apiError, getApiUser } from "@/lib/api";
import { releasePathClaim } from "@/lib/agent-coordination";
import { getWorkspaceForMember } from "@/lib/workspaces";

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      workspaceId: string;
      sessionId: string;
      claimId: string;
    }>;
  },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, sessionId, claimId } = await params;
  if (!(await getWorkspaceForMember(workspaceId, user.id))) {
    return apiError(new Error("Workspace not found."), 404);
  }
  try {
    return Response.json({
      claim: await releasePathClaim(workspaceId, sessionId, claimId),
    });
  } catch (error) {
    return apiError(error);
  }
}
