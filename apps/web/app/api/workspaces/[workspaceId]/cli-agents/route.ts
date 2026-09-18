import { z } from "zod";

import { withWorkspace } from "@/lib/http/api-route";
import {
  mintCoordinationToken,
  registerCliAgentSession,
} from "@/lib/agents/cli-agent-session";

export const runtime = "nodejs";

const bodySchema = z.object({
  branch: z.string().trim().min(1).max(255),
  worktreeName: z.string().trim().min(1).max(255),
  headSha: z.string().trim().min(1).max(255),
  agentKind: z.string().trim().min(1).max(64),
});

/**
 * The embedded IDE calls this when it creates an agent's isolated worktree, to
 * enrol that CLI agent in workspace coordination. Returns the coordination MCP
 * URL and a scoped bearer token for the IDE to drop into the agent's
 * `.mcp.json`.
 */
export const POST = withWorkspace(
  "coSteer",
  async ({ request, user, workspaceId }) => {
    const input = bodySchema.parse(await request.json());
    const { sessionId } = await registerCliAgentSession({
      workspaceId,
      userId: String(user.id),
      branch: input.branch,
      worktreeName: input.worktreeName,
      headSha: input.headSha,
      agentKind: input.agentKind,
    });
    const token = mintCoordinationToken({
      workspaceId,
      sessionId,
      userId: String(user.id),
    });
    const mcpUrl = new URL(
      `/api/workspaces/${workspaceId}/mcp/coordination`,
      new URL(request.url).origin,
    ).toString();
    return Response.json({ sessionId, mcpUrl, mcpToken: token });
  },
);
