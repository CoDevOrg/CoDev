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
    // "discarded" removed the checkout; "stopped" ended this agent only,
    // because other agents are still live in the same worktree. The caller
    // needs the difference to say whether a capacity slot came back.
    const result = await discardAgentWorktree(workspaceId, sessionId, user.id);
    return Response.json(result);
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
