import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { loadWorkboardSnapshot } from "@/lib/workboard-server";

type Context = {
  params: Promise<{ workspaceId: string }>;
};

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
    return Response.json(await loadWorkboardSnapshot(workspaceId, user));
  } catch (error) {
    return apiError(error);
  }
}
