import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ codexExecRequest: vi.fn() }));

vi.mock("../runtime/orchestrator-request", () => ({
  codexExecRequest: (...args: unknown[]) => mocks.codexExecRequest(...args),
}));

import {
  checkSupersetAgentRecovery,
  pollSupersetAgent,
  sendSupersetAgentInput,
  startSupersetAgent,
  stopSupersetAgent,
} from "./superset-agent-orchestrator-client";

function jsonResponse(body: unknown) {
  return { json: () => Promise.resolve(body) };
}

const workspaceId = "workspace-1";
const agentId = "agent-1";

describe("Superset agent orchestrator client", () => {
  beforeEach(() => {
    mocks.codexExecRequest.mockReset();
  });

  it("posts a start request to the sandbox-scoped path", async () => {
    mocks.codexExecRequest.mockResolvedValue(
      jsonResponse({
        hostWorkspaceId: "host-ws-1",
        hostTerminalId: "term-1",
        hostAgentSessionId: "agent-1",
      }),
    );
    const result = await startSupersetAgent(workspaceId, {
      worktreeId: "main",
      provider: "openai",
      command: ["codex", "exec"],
      idempotencyKey: "key-1",
    });
    expect(mocks.codexExecRequest).toHaveBeenCalledWith(
      "POST",
      `/v1/sandboxes/${workspaceId}/superset-agents`,
      expect.objectContaining({ worktreeId: "main" }),
      expect.any(Number),
    );
    expect(result.hostAgentSessionId).toBe("agent-1");
  });

  it("sends input to the agent-scoped input path", async () => {
    mocks.codexExecRequest.mockResolvedValue(jsonResponse({}));
    await sendSupersetAgentInput(workspaceId, agentId, "y\n");
    expect(mocks.codexExecRequest).toHaveBeenCalledWith(
      "POST",
      `/v1/sandboxes/${workspaceId}/superset-agents/${agentId}/input`,
      { data: "y\n" },
      expect.any(Number),
    );
  });

  it("polls with the after cursor", async () => {
    mocks.codexExecRequest.mockResolvedValue(
      jsonResponse({
        chunks: [],
        nextSequence: 3,
        exited: false,
        exitCode: null,
        refreshReady: false,
      }),
    );
    await pollSupersetAgent(workspaceId, agentId, 3);
    expect(mocks.codexExecRequest).toHaveBeenCalledWith(
      "POST",
      `/v1/sandboxes/${workspaceId}/superset-agents/${agentId}/poll`,
      expect.objectContaining({ after: 3 }),
      expect.any(Number),
    );
  });

  it("stops with DELETE", async () => {
    mocks.codexExecRequest.mockResolvedValue(jsonResponse({}));
    await stopSupersetAgent(workspaceId, agentId);
    expect(mocks.codexExecRequest).toHaveBeenCalledWith(
      "DELETE",
      `/v1/sandboxes/${workspaceId}/superset-agents/${agentId}`,
      undefined,
      expect.any(Number),
    );
  });

  it("checks recovery with GET", async () => {
    mocks.codexExecRequest.mockResolvedValue(jsonResponse({ adoptable: true }));
    const result = await checkSupersetAgentRecovery(workspaceId, agentId);
    expect(mocks.codexExecRequest).toHaveBeenCalledWith(
      "GET",
      `/v1/sandboxes/${workspaceId}/superset-agents/${agentId}/recovery`,
      undefined,
      expect.any(Number),
    );
    expect(result).toEqual({ adoptable: true });
  });
});
