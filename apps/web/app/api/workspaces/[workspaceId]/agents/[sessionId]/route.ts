import { discardAgentWorktree, ReviewActionError } from "@/lib/agent-review";
import { apiError, getApiUser } from "@/lib/api";
import { OrchestratorError } from "@/lib/orchestrator";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ workspaceId: string; sessionId: string }>;
  },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, sessionId } = await params;

  try {
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    await discardAgentWorktree(workspaceId, sessionId, user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ReviewActionError) {
      return apiError(error, error.status);
    }
    if (error instanceof OrchestratorError) {
      return Response.json(
        { error: error.message, conflictPaths: error.conflictPaths },
        { status: error.status },
      );
    }
    return apiError(error);
  }
}
