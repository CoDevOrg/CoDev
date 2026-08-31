import { apiError } from "@/lib/api";
import {
  COORDINATION_BEARER_PREFIX,
  openCoordinationToken,
  openWorkspaceCoordinationToken,
  resolveCliAgentSessionForBranch,
} from "@/lib/cli-agent-session";
import {
  callCoordinationTool,
  COORDINATION_TOOLS,
} from "@/lib/coordination-mcp-tools";
import { handleMcpHttpRequest } from "@/lib/mcp-server";

export const runtime = "nodejs";

/**
 * Coordination MCP server for the workspace's agent CLIs. Streamable-HTTP
 * transport. Two token shapes are accepted:
 *
 *  - a **session-scoped** token (from `POST .../cli-agents`) that names one
 *    agent's `sessionId` — every tool call is that agent's.
 *  - a **workspace-scoped** token (seeded into the workspace's `~/.claude.json`
 *    by the orchestrator, shared by every agent CLI). Here the agent identifies
 *    its own worktree by passing `branch` on each tool call, and the `cli`
 *    session is resolved (created on first use) from that.
 */

function jsonRpcError(status: number, message: string) {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message } },
    { status },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith(COORDINATION_BEARER_PREFIX)
    ? header.slice(COORDINATION_BEARER_PREFIX.length)
    : header;

  const sessionClaims = openCoordinationToken(token);
  const workspaceClaims = sessionClaims ? null : openWorkspaceCoordinationToken(token);

  const scopedWorkspaceId =
    sessionClaims?.workspaceId ?? workspaceClaims?.workspaceId ?? null;
  if (!scopedWorkspaceId || scopedWorkspaceId !== workspaceId) {
    return jsonRpcError(401, "Invalid or expired coordination token.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } },
      { status: 200 },
    );
  }

  const callTool = async (name: string, rawArgs: unknown) => {
    const args =
      rawArgs && typeof rawArgs === "object"
        ? (rawArgs as Record<string, unknown>)
        : {};

    if (sessionClaims) {
      return callCoordinationTool(
        {
          workspaceId,
          sessionId: sessionClaims.sessionId,
          userId: sessionClaims.userId,
        },
        name,
        args,
      );
    }

    // Workspace-scoped token: the agent must name its branch so we can resolve
    // (or create) its session.
    const branch = typeof args.branch === "string" ? args.branch.trim() : "";
    if (!branch) {
      return {
        text: "This coordination server is shared by every agent in the workspace — pass `branch` (your current git branch, e.g. from `git branch --show-current`) so your session can be identified.",
        isError: true,
      };
    }
    const { sessionId, ownerId } = await resolveCliAgentSessionForBranch({
      workspaceId,
      branch,
      ...(typeof args.agentKind === "string" ? { agentKind: args.agentKind } : {}),
    });
    const toolArgs = { ...args };
    delete toolArgs.branch;
    delete toolArgs.agentKind;
    return callCoordinationTool(
      { workspaceId, sessionId, userId: ownerId },
      name,
      toolArgs,
    );
  };

  try {
    const { status, json } = await handleMcpHttpRequest(
      {
        serverName: "codev-coordination",
        serverVersion: "1.0.0",
        tools: COORDINATION_TOOLS,
        callTool,
      },
      body,
    );
    return json === undefined
      ? new Response(null, { status })
      : Response.json(json, { status });
  } catch (error) {
    return apiError(error);
  }
}

/** The server→client SSE stream is not offered — this server never initiates. */
export function GET() {
  return new Response("Method Not Allowed", { status: 405 });
}
