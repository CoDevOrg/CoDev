import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ codexExecRequest: vi.fn() }));

vi.mock("../runtime/orchestrator-request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/orchestrator-request")>()),
  codexExecRequest: (...args: unknown[]) => mocks.codexExecRequest(...args),
}));
import { OrchestratorError } from "../runtime/orchestrator-request";

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

  it("supports older Codex guests without dropping the neutral launch profile", async () => {
    mocks.codexExecRequest.mockResolvedValue(
      jsonResponse({
        hostWorkspaceId: "w",
        hostTerminalId: "t",
        hostAgentSessionId: "a",
      }),
    );
    const launchProfile = {
      files: [{ path: ".codex/auth.json", contents: "test-only-auth" }],
      env: { CODEX_HOME: "{{profileDir}}/.codex" },
    };
    await startSupersetAgent(workspaceId, {
      worktreeId: "main",
      provider: "openai",
      launchProfile,
      command: ["codex", "exec"],
      idempotencyKey: "legacy",
    });
    expect(mocks.codexExecRequest.mock.calls[0]![2]).toMatchObject({
      launchProfile,
      codexAuthCacheJson: "test-only-auth",
    });
  });

  it("does not pass Codex credentials to another provider", async () => {
    mocks.codexExecRequest.mockResolvedValue(
      jsonResponse({
        hostWorkspaceId: "w",
        hostTerminalId: "t",
        hostAgentSessionId: "a",
      }),
    );
    await startSupersetAgent(workspaceId, {
      worktreeId: "main",
      provider: "anthropic",
      launchProfile: {
        files: [{ path: ".codex/auth.json", contents: "test-only-auth" }],
      },
      command: ["claude"],
      idempotencyKey: "claude",
    });
    expect(mocks.codexExecRequest.mock.calls[0]![2]).not.toHaveProperty(
      "codexAuthCacheJson",
    );
  });

  it("explains an incompatible runtime without blaming the user's prompt", async () => {
    mocks.codexExecRequest.mockRejectedValue(
      new OrchestratorError("Invalid Superset agent start request.", 400),
    );
    await expect(
      startSupersetAgent(workspaceId, {
        worktreeId: "main",
        provider: "anthropic",
        command: ["claude"],
        idempotencyKey: "old",
      }),
    ).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("runtime needs an update"),
    });
    expect(mocks.codexExecRequest).toHaveBeenCalledTimes(1);
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

  it("decodes output from an older orchestrator without losing Unicode", async () => {
    mocks.codexExecRequest.mockResolvedValue(
      jsonResponse({
        chunks: [
          {
            sequence: 1,
            dataBase64: Buffer.from("Hello 👋\n").toString("base64"),
          },
        ],
        nextSequence: 1,
        exited: true,
        exitCode: 0,
        refreshReady: true,
      }),
    );
    expect((await pollSupersetAgent(workspaceId, agentId, 0)).chunks).toEqual([
      { sequence: 1, data: "Hello 👋\n" },
    ]);
  });

  it("reads the real orchestrator result envelope", async () => {
    mocks.codexExecRequest.mockResolvedValue(
      jsonResponse({
        result: {
          chunks: [
            { sequence: 1, dataBase64: Buffer.from("Hi").toString("base64") },
          ],
          nextSequence: 1,
          exited: false,
          exitCode: null,
          refreshReady: false,
        },
      }),
    );
    expect(
      (await pollSupersetAgent(workspaceId, agentId, 0)).chunks[0]!.data,
    ).toBe("Hi");
    mocks.codexExecRequest.mockResolvedValue(
      jsonResponse({ result: { adoptable: true } }),
    );
    expect(await checkSupersetAgentRecovery(workspaceId, agentId)).toEqual({
      adoptable: true,
    });
  });

  it("rejects poll chunks with neither supported output field", async () => {
    mocks.codexExecRequest.mockResolvedValue(
      jsonResponse({
        chunks: [{ sequence: 1 }],
        nextSequence: 1,
        exited: false,
        exitCode: null,
        refreshReady: false,
      }),
    );
    await expect(pollSupersetAgent(workspaceId, agentId, 0)).rejects.toThrow();
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
