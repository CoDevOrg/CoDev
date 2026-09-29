import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCredential: vi.fn(),
  provision: vi.fn(),
  start: vi.fn(),
  poll: vi.fn(),
  close: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("./resolve", () => ({
  requireCredential: (...args: unknown[]) => mocks.requireCredential(...args),
}));

vi.mock("../runtime/orchestrator", () => ({
  ensureHostReady: vi.fn(),
  provisionSandbox: mocks.provision,
  startCodexExecInSandbox: mocks.start,
  pollCodexExecInSandbox: mocks.poll,
  closeCodexExecInSandbox: mocks.close,
  destroySandbox: mocks.destroy,
}));

import {
  cleanupClaudeExecution,
  claudePrintArgs,
  parseClaudeResult,
  pollClaudeExecution,
  startClaudeExecution,
} from "./claude-runtime-execution";

const requestId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireCredential.mockResolvedValue({
    ok: true,
    provider: "claude",
    kind: "claude_setup_token",
    source: "personal",
    credentialId: "credential-1",
    secret: { kind: "claude_setup_token", token: "sk-ant-oat01-token" },
  });
  mocks.start.mockResolvedValue("codex-1-1");
  mocks.provision.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.destroy.mockResolvedValue(undefined);
  mocks.poll.mockResolvedValue({
    chunks: [],
    nextSequence: 0,
    exited: false,
    exitCode: null,
  });
});

describe("Claude execution", () => {
  it("runs in a throwaway sandbox with the token in the environment", async () => {
    // It used to resume a Firecracker snapshot kept per member, because the
    // credential *was* the signed-in profile inside it. The token replaces
    // both the snapshot and the resume.
    await startClaudeExecution("sender", "sonnet", "hello", requestId, {});

    expect(mocks.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: requestId,
        ephemeral: true,
        resumeFromSnapshot: false,
      }),
    );
    const input = mocks.start.mock.calls[0]?.[1] as {
      command: string[];
      launchProfile: { env?: Record<string, string> };
    };
    expect(input.launchProfile.env).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-token",
    });
    // Never on the command line, where another member's shell could read it
    // out of `ps`.
    expect(input.command.join(" ")).not.toContain("sk-ant-oat01-token");
    expect(input.command).toContain("claude");
  });

  it("refuses to run without a Claude login", async () => {
    mocks.requireCredential.mockResolvedValue({
      ok: true,
      provider: "claude",
      kind: "api_key",
      source: "personal",
      credentialId: "credential-1",
      secret: { kind: "api_key", apiKey: "sk-ant-key" },
    });

    await expect(
      startClaudeExecution("sender", "sonnet", "hello", requestId, {}),
    ).rejects.toThrow(/Reconnect Claude/);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("destroys the sandbox when the turn cannot start", async () => {
    mocks.start.mockRejectedValue(new Error("guest down"));

    await expect(
      startClaudeExecution("sender", "sonnet", "hello", requestId, {}),
    ).rejects.toThrow(/could not start/);
    expect(mocks.destroy).toHaveBeenCalledWith(requestId);
  });

  it("destroys the sandbox on cleanup even if closing the process fails", async () => {
    const reference = await startClaudeExecution(
      "sender",
      "sonnet",
      "hello",
      requestId,
      {},
    );
    mocks.close.mockRejectedValue(new Error("already gone"));

    await expect(cleanupClaudeExecution(reference)).rejects.toThrow(
      "already gone",
    );
    // Nothing in the sandbox is worth keeping, so it goes regardless.
    expect(mocks.destroy).toHaveBeenCalledWith(requestId);
  });

  it("polls the sandbox the turn started in", async () => {
    const reference = await startClaudeExecution(
      "sender",
      "sonnet",
      "hello",
      requestId,
      {},
    );
    mocks.poll.mockResolvedValue({
      chunks: [{ sequence: 1, dataBase64: "e30=" }],
      nextSequence: 1,
      exited: true,
      exitCode: 0,
    });

    const result = await pollClaudeExecution(reference, 0);

    expect(mocks.poll).toHaveBeenCalledWith(requestId, "codex-1-1", 0);
    expect(result.exited).toBe(true);
    // The Codex auth cache a shared poll route may carry is not Claude's to
    // return, and never reaches the caller.
    expect(result).not.toHaveProperty("codexAuthCacheJson");
  });

  it("rejects a reference it did not issue", async () => {
    await expect(pollClaudeExecution("not-a-claude-run", 0)).rejects.toThrow(
      /Invalid Claude execution reference/,
    );
  });
});

describe("claudePrintArgs", () => {
  it("accepts only official CLI model aliases", () => {
    expect(claudePrintArgs("sonnet")).toContain("--model");
    expect(() => claudePrintArgs("claude-3-5-sonnet-20241022")).toThrow(
      /official Claude CLI model alias/,
    );
  });
});

describe("parseClaudeResult", () => {
  it("reads the last successful result envelope", () => {
    const output = [
      '{"type":"system"}',
      '{"type":"result","result":"done"}',
    ].join("\n");
    expect(parseClaudeResult(output).result).toBe("done");
  });

  it("refuses an errored envelope", () => {
    const output = '{"type":"result","is_error":true,"result":"nope"}';
    expect(() => parseClaudeResult(output)).toThrow(/no successful result/);
  });
});
