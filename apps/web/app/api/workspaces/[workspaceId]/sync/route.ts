import { apiError, getApiUser } from "@/lib/api";
import {
  syncWorkspaceToDefaultBranch,
  WorkspaceLifecycleError,
} from "@/lib/workspaces";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    const sync = await syncWorkspaceToDefaultBranch(workspaceId, user.id);
    return Response.json({ sync });
  } catch (error) {
    return apiError(
      error,
      error instanceof WorkspaceLifecycleError ? error.status : 502,
    );
  }
}
