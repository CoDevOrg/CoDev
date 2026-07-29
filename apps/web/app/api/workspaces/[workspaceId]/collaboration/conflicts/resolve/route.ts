import { apiError, getApiUser } from "@/lib/api";
import {
  CollaborationConflictResolutionError,
  resolveCollaborationConflict,
} from "@/lib/collaboration-server";
import { getWorkspaceForMember } from "@/lib/workspaces";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  if (!(await getWorkspaceForMember(workspaceId, user.id))) {
    return apiError(new Error("Workspace not found."), 404);
  }
  try {
    return Response.json(
      await resolveCollaborationConflict(
        workspaceId,
        user.id,
        await request.json(),
      ),
    );
  } catch (error) {
    return apiError(
      error,
      error instanceof CollaborationConflictResolutionError ? 409 : 400,
    );
  }
}
