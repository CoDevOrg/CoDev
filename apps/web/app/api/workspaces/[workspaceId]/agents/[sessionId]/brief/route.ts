import { requireWorkspacePermission } from "@/lib/access";
import { apiError, getApiUser } from "@/lib/api";
import { getAgentBrief, updateAgentBrief } from "@/lib/workspace-brain";

type Context = {
  params: Promise<{ workspaceId: string; sessionId: string }>;
};

function permissionStatus(error: unknown) {
  return error instanceof Error && "status" in error
    ? Number((error as { status: unknown }).status)
    : 403;
}

export async function GET(_request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, sessionId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
  } catch (error) {
    return apiError(error, permissionStatus(error));
  }
  try {
    return Response.json({
      brief: await getAgentBrief(workspaceId, sessionId),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, sessionId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "coSteer");
  } catch (error) {
    return apiError(error, permissionStatus(error));
  }
  try {
    return Response.json({
      brief: await updateAgentBrief(
        workspaceId,
        sessionId,
        await request.json(),
      ),
    });
  } catch (error) {
    return apiError(error, 400);
  }
}
