import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { cancelWorkspacePathClaim } from "@/lib/path-claims-server";

type Context = {
  params: Promise<{ workspaceId: string }>;
};

export async function POST(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "coSteer");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }
  try {
    return Response.json(
      await cancelWorkspacePathClaim(workspaceId, user, await request.json()),
    );
  } catch (error) {
    return apiError(error);
  }
}
