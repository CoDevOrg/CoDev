import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import {
  listCollaborationConflicts,
  reportCollaborationConflict,
} from "@/lib/collaboration-server";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    return Response.json({
      conflicts: await listCollaborationConflicts(workspaceId),
    });
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 400,
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "edit");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }
  try {
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    return Response.json(
      await reportCollaborationConflict(workspaceId, await request.json()),
    );
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 400,
    );
  }
}
