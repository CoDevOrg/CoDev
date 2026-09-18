import { rebaseAgentReview } from "@/lib/agents/agent-review";
import { withUser } from "@/lib/http/api-route";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime/runtime-resume";

export const POST = withUser<{ workspaceId: string; sessionId: string }>(
  async ({ user, params: { workspaceId, sessionId } }) => {
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    return Response.json({
      review: await rebaseAgentReview(workspaceId, sessionId, user.id),
    });
  },
);
