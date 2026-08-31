import { describe, expect, it, vi } from "vitest";

import {
  handleMcpHttpRequest,
  MCP_PROTOCOL_VERSION,
  type McpServerConfig,
} from "./mcp-server";

function config(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    serverName: "test",
    serverVersion: "9.9.9",
    tools: [
      {
        name: "echo",
        description: "echo it back",
        inputSchema: { type: "object", properties: { value: { type: "string" } } },
      },
    ],
    callTool: vi.fn(async (name: string, args: unknown) => ({
      text: `${name}:${JSON.stringify(args)}`,
      isError: false,
    })),
    ...overrides,
  };
}

describe("handleMcpHttpRequest", () => {
  it("answers initialize with the protocol version and server info", async () => {
    const response = await handleMcpHttpRequest(config(), {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      id: 1,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "test", version: "9.9.9" },
      },
    });
  });

  it("lists tools", async () => {
    const response = await handleMcpHttpRequest(config(), {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(response.json).toMatchObject({
      id: 2,
      result: { tools: [{ name: "echo" }] },
    });
  });

  it("dispatches tools/call and wraps the result as MCP content", async () => {
    const cfg = config();
    const response = await handleMcpHttpRequest(cfg, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "echo", arguments: { value: "hi" } },
    });
    expect(cfg.callTool).toHaveBeenCalledWith("echo", { value: "hi" });
    expect(response.json).toMatchObject({
      id: 3,
      result: {
        content: [{ type: "text", text: 'echo:{"value":"hi"}' }],
        isError: false,
      },
    });
  });

  it("treats notifications/initialized as a no-op with HTTP 202", async () => {
    const response = await handleMcpHttpRequest(config(), {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(response).toEqual({ status: 202 });
  });

  it("returns method-not-found for an unknown request", async () => {
    const response = await handleMcpHttpRequest(config(), {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/delete",
    });
    expect(response.json).toMatchObject({
      id: 4,
      error: { code: -32601 },
    });
  });

  it("rejects a tools/call without a name", async () => {
    const response = await handleMcpHttpRequest(config(), {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {},
    });
    expect(response.json).toMatchObject({ id: 5, error: { code: -32602 } });
  });

  it("handles a batch, dropping notification entries from the response", async () => {
    const response = await handleMcpHttpRequest(config(), [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.json)).toBe(true);
    expect((response.json as unknown[]).length).toBe(2);
  });

  it("202s a batch that is only notifications", async () => {
    const response = await handleMcpHttpRequest(config(), [
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    expect(response).toEqual({ status: 202 });
  });
});
