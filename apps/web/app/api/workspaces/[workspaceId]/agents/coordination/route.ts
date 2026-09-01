import { requireWorkspacePermission } from "@/lib/access";
import { apiError, getApiUser } from "@/lib/api";
import { loadWorkspaceCoordinationSnapshot } from "@/lib/coordination-snapshot-server";

type Context = {
  params: Promise<{ workspaceId: string }>;
};

/**
 * The live claims and overlaps behind Mission Control's collision banner.
 * Read-only, so `view` is enough — seeing that two agents are on the same file
 * is exactly what a viewer is in the workspace for.
 */
export async function GET(_request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }
  try {
    return Response.json(await loadWorkspaceCoordinationSnapshot(workspaceId));
  } catch (error) {
    return apiError(error);
  }
}
