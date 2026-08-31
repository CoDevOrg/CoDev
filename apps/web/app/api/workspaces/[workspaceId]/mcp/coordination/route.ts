import { apiError } from "@/lib/api";
import {
  COORDINATION_BEARER_PREFIX,
  openCoordinationToken,
} from "@/lib/cli-agent-session";
import {
  callCoordinationTool,
  COORDINATION_TOOLS,
} from "@/lib/coordination-mcp-tools";
import { handleMcpHttpRequest } from "@/lib/mcp-server";

export const runtime = "nodejs";

/**
 * Coordination MCP server for the workspace's agent CLIs. Streamable-HTTP
 * transport: the agent's `.mcp.json` points at this URL with the bearer token
 * minted by `POST /api/workspaces/[id]/cli-agents`. The token carries the
 * agent's `sessionId`, so every tool call is scoped to the right agent without
 * a session cookie.
 */

function unauthorized() {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Invalid or expired coordination token." },
    },
    { status: 401 },
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
  const claims = openCoordinationToken(token);
  if (!claims || claims.workspaceId !== workspaceId) {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error." },
      },
      { status: 200 },
    );
  }

  try {
    const { status, json } = await handleMcpHttpRequest(
      {
        serverName: "codev-coordination",
        serverVersion: "1.0.0",
        tools: COORDINATION_TOOLS,
        callTool: (name, args) =>
          callCoordinationTool(
            {
              workspaceId,
              sessionId: claims.sessionId,
              userId: claims.userId,
            },
            name,
            args,
          ),
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
