import { rebaseAgentReview } from "@/lib/agent-review";
import { withUser } from "@/lib/api-route";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

export const POST = withUser<{ workspaceId: string; sessionId: string }>(
  async ({ user, params: { workspaceId, sessionId } }) => {
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    return Response.json({
      review: await rebaseAgentReview(workspaceId, sessionId, user.id),
    });
  },
);
