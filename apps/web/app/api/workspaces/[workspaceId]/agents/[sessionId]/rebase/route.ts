import { rebaseAgentReview, ReviewActionError } from "@/lib/agent-review";
import { apiError, getApiUser } from "@/lib/api";
import { OrchestratorError } from "@/lib/orchestrator";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

export async function POST(
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
    return Response.json({
      review: await rebaseAgentReview(workspaceId, sessionId, user.id),
    });
  } catch (error) {
    if (error instanceof ReviewActionError)
      return apiError(error, error.status);
    if (error instanceof OrchestratorError) {
      return Response.json(
        { error: error.message, conflictPaths: error.conflictPaths },
        { status: error.status },
      );
    }
    return apiError(error);
  }
}
