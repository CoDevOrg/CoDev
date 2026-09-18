import { prepareAgentReview } from "@/lib/agent-review";
import { withUser } from "@/lib/api-route";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

export const POST = withUser<{ workspaceId: string; sessionId: string }>(
  async ({ user, params: { workspaceId, sessionId } }) => {
    await ensureWorkspaceRuntimeReady(workspaceId, user.id, "review");
    return Response.json({
      review: await prepareAgentReview(workspaceId, sessionId, user.id),
    });
  },
);
