import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { releasePathClaim } from "@/lib/agent-coordination";

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
  try {
    await requireWorkspacePermission(workspaceId, user.id, "coSteer");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }
  try {
    return Response.json({
      claim: await releasePathClaim(workspaceId, sessionId, claimId),
    });
  } catch (error) {
    return apiError(error);
  }
}
