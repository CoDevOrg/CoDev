import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  provision: vi.fn(),
  start: vi.fn(),
  poll: vi.fn(),
  close: vi.fn(),
  snapshot: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("./claude-connection-session", () => ({
  getConnectedClaudeRuntime: mocks.connection,
}));
vi.mock("./claude-subscription-execution", () => ({
  claimClaudeSubscriptionExecution: mocks.claim,
  releaseClaudeSubscriptionExecution: mocks.release,
}));
vi.mock("./orchestrator", () => ({
  ensureHostReady: vi.fn(),
  provisionSandbox: mocks.provision,
  getSandbox: async () => ({ headSha: "a".repeat(40) }),
  startCodexExecInSandbox: mocks.start,
  pollCodexExecInSandbox: mocks.poll,
  closeCodexExecInSandbox: mocks.close,
  snapshotWorkspace: mocks.snapshot,
  destroySandbox: mocks.destroy,
}));
import { encodeClaudeRuntimeReference } from "./claude-runtime-reference";
import {
  startClaudeExecution,
  pollClaudeExecution,
  cleanupClaudeExecution,
  claudePrintArgs,
  parseClaudeResult,
} from "./claude-runtime-execution";
const profileId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
let leaseUntil: number;
beforeEach(() => {
  vi.resetAllMocks();
  leaseUntil = Date.now() + 600_000;
  mocks.connection.mockResolvedValue({
    id: connectionId,
    userId: "sender",
    expiresAt: new Date(leaseUntil),
    runnerId: encodeClaudeRuntimeReference({
      version: 1,
      backend: "orchestrator",
      profileId,
      sessionId: "claude-1-1",
    }),
  });
  mocks.claim.mockResolvedValue(leaseUntil);
  mocks.start.mockResolvedValue("codex-1-1");
  mocks.poll.mockResolvedValue({
    chunks: [],
    nextSequence: 0,
    exited: true,
    exitCode: 0,
    codexAuthCacheJson: "must-not-escape",
  });
  mocks.destroy.mockResolvedValue(undefined);
});
describe("private Claude execution", () => {
  it("resumes only the sender's profile and never injects credentials", async () => {
    const id = await startClaudeExecution(
      "sender",
      "sonnet",
      "Hello",
      "request-1",
    );
    expect(mocks.claim).toHaveBeenCalledWith(connectionId, "sender");
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: profileId,
        resumeFromSnapshot: true,
      }),
    );
    const input = mocks.start.mock.calls[0]![1];
    expect(input).not.toHaveProperty("codexAuthCacheJson");
    expect(input.command).toEqual(
      expect.arrayContaining([
        "claude",
        "--tools",
        "",
        "CLAUDE_CONFIG_DIR=/tmp/claude-1-1/config",
      ]),
    );
    expect(input.command.length).toBeLessThanOrEqual(32);
    expect(JSON.stringify(input)).not.toContain("OAUTH_TOKEN");
    expect(await pollClaudeExecution(id, 0)).not.toHaveProperty(
      "codexAuthCacheJson",
    );
    await cleanupClaudeExecution(id);
    expect(mocks.snapshot).toHaveBeenCalledWith(profileId, "a".repeat(40));
    expect(mocks.destroy).toHaveBeenCalledWith(profileId);
    expect(mocks.release).toHaveBeenCalledWith(connectionId, leaseUntil);
  });
  it("does not start or release another execution's busy seat", async () => {
    mocks.claim.mockRejectedValue(new Error("busy"));
    await expect(
      startClaudeExecution("sender", "sonnet", "Hello", "request"),
    ).rejects.toThrow("busy");
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it("stale cleanup cannot stop a newer run in the same runtime", async () => {
    const id = await startClaudeExecution("sender", "opus", "Hello", "request");
    const current = await mocks.connection();
    mocks.connection.mockResolvedValue({
      ...current,
      expiresAt: new Date(leaseUntil + 1000),
    });
    await cleanupClaudeExecution(id);
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it("rechecks revocation before polling and does not resnapshot revoked profiles", async () => {
    const id = await startClaudeExecution(
      "sender",
      "haiku",
      "Hello",
      "request",
    );
    mocks.connection.mockResolvedValue(null);
    await expect(pollClaudeExecution(id, 0)).rejects.toThrow(/revoked/);
    await cleanupClaudeExecution(id);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("retains the lease if cleanup cannot stop the process", async () => {
    const id = await startClaudeExecution(
      "sender",
      "sonnet",
      "Hello",
      "request",
    );
    mocks.close.mockRejectedValue(new Error("unreachable"));
    await expect(cleanupClaudeExecution(id)).rejects.toThrow();
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it("rejects unvalidated models, oversized context, and failed CLI output", async () => {
    expect(() => claudePrintArgs("--unsafe")).toThrow();
    await expect(
      startClaudeExecution("sender", "sonnet", "x".repeat(120_001), "request"),
    ).rejects.toThrow(/too large/);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(() =>
      parseClaudeResult(
        '{"type":"result","is_error":true,"result":"private details"}',
      ),
    ).toThrow(/no successful result/);
    expect(() =>
      parseClaudeResult(
        '{"type":"result","result":"old success"}\n{"type":"result","is_error":true}',
      ),
    ).toThrow(/no successful result/);
    expect(
      parseClaudeResult('{"type":"result","is_error":false,"result":"OK"}')
        .result,
    ).toBe("OK");
  });
});
