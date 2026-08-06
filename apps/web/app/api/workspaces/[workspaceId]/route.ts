import { apiError, getApiUser } from "@/lib/api";
import { deleteWorkspace } from "@/lib/workspaces";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  try {
    await deleteWorkspace(workspaceId, user.id);
    return Response.json({ success: true, workspaceId });
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 500,
    );
  }
}
