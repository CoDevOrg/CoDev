import { discardAgentWorktree } from "@/lib/agents/agent-review";
import { withUser } from "@/lib/http/api-route";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime/runtime-resume";

export const DELETE = withUser<{ workspaceId: string; sessionId: string }>(
  async ({ user, params: { workspaceId, sessionId } }) => {
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    // "discarded" removed the checkout; "stopped" ended this agent only,
    // because other agents are still live in the same worktree. The caller
    // needs the difference to say whether a capacity slot came back.
    return Response.json(
      await discardAgentWorktree(workspaceId, sessionId, user.id),
    );
  },
);
