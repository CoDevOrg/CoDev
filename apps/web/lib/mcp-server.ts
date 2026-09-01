import "server-only";

/**
 * A minimal MCP server over the Streamable-HTTP transport: enough of the
 * JSON-RPC surface for a stateless, tools-only server that Claude Code and
 * Codex can both talk to (`initialize`, `tools/list`, `tools/call`, `ping`,
 * plus the `notifications/initialized` no-op). We answer every POST with a
 * single `application/json` JSON-RPC response, which the spec allows in place
 * of an SSE stream; GET (the server→client stream) is unsupported.
 *
 * Kept dependency-free on purpose — the surface is small and fully covered by
 * unit tests, and it avoids pulling the MCP SDK into the web bundle.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolResult = { text: string; isError: boolean };

export type McpServerConfig = {
  serverName: string;
  serverVersion: string;
  tools: readonly McpToolDefinition[];
  callTool: (name: string, args: unknown) => Promise<McpToolResult>;
};

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
};

export type McpHttpResponse = {
  status: number;
  /** Omitted for a pure-notification POST (HTTP 202, empty body). */
  json?: unknown;
};

function result(id: JsonRpcId, value: unknown) {
  return { jsonrpc: "2.0", id, result: value };
}

function error(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleOne(
  config: McpServerConfig,
  request: JsonRpcRequest,
): Promise<unknown | null> {
  const { id = null, method, params } = request;
  const isNotification = request.id === undefined;

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: config.serverName,
          version: config.serverVersion,
        },
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, {
        tools: config.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case "tools/call": {
      const call =
        params && typeof params === "object"
          ? (params as { name?: unknown; arguments?: unknown })
          : {};
      if (typeof call.name !== "string") {
        return error(id, -32602, "tools/call requires a string `name`.");
      }
      const toolResult = await config.callTool(call.name, call.arguments);
      return result(id, {
        content: [{ type: "text", text: toolResult.text }],
        isError: toolResult.isError,
      });
    }

    default:
      if (isNotification) {
        return null;
      }
      return error(id, -32601, `Method not found: ${String(method)}`);
  }
}

export async function handleMcpHttpRequest(
  config: McpServerConfig,
  body: unknown,
): Promise<McpHttpResponse> {
  if (Array.isArray(body)) {
    const responses = (
      await Promise.all(
        body.map((entry) => handleOne(config, entry as JsonRpcRequest)),
      )
    ).filter((entry): entry is object => entry !== null);
    return responses.length === 0
      ? { status: 202 }
      : { status: 200, json: responses };
  }

  if (!body || typeof body !== "object") {
    return {
      status: 200,
      json: error(null, -32700, "Parse error: expected a JSON-RPC object."),
    };
  }

  const response = await handleOne(config, body as JsonRpcRequest);
  return response === null ? { status: 202 } : { status: 200, json: response };
}
