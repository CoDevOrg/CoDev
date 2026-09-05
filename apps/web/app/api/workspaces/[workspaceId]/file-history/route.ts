import { apiError, getApiUser } from "@/lib/api";
import { getWorkspaceFileHistory } from "@/lib/workspace-restore";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  const path = new URL(request.url).searchParams.get("path");
  if (!path) return apiError(new Error("A file path is required."), 400);

  try {
    return Response.json({
      entries: await getWorkspaceFileHistory(workspaceId, user.id, path),
    });
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 502,
    );
  }
}
