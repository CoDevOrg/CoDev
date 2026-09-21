import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(),
  requireChat: vi.fn(),
  listMessages: vi.fn(),
  appendMessage: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  resolveHosted: vi.fn(),
  decrypt: vi.fn(),
  updateCache: vi.fn(),
  ensureHostReady: vi.fn(),
  start: vi.fn(),
  poll: vi.fn(),
  close: vi.fn(),
  getAgentModel: vi.fn(),
  createTurn: vi.fn(),
  recordChunks: vi.fn(),
}));

vi.mock("./workspaces", () => ({
  requireGen2Member: (...args: unknown[]) => mocks.requireMember(...args),
}));

vi.mock("./chats", () => ({
  requireGen2Chat: (...args: unknown[]) => mocks.requireChat(...args),
  listGen2ChatMessages: (...args: unknown[]) => mocks.listMessages(...args),
  appendGen2ChatMessage: (...args: unknown[]) => mocks.appendMessage(...args),
}));

vi.mock("./turns", () => ({
  createGen2Turn: (...args: unknown[]) => mocks.createTurn(...args),
  recordGen2TurnChunks: (...args: unknown[]) => mocks.recordChunks(...args),
}));

vi.mock("../platform/observability", () => ({
  logEvent: vi.fn(),
}));

vi.mock("../providers/ai-model", () => ({
  getAgentModel: () => mocks.getAgentModel(),
}));

vi.mock("../runtime/orchestrator-health", () => ({
  ensureHostReady: (...args: unknown[]) => mocks.ensureHostReady(...args),
}));

vi.mock("../runtime/orchestrator-codex-exec", () => ({
  startCodexExecInSandbox: (...args: unknown[]) => mocks.start(...args),
  pollCodexExecInSandbox: (...args: unknown[]) => mocks.poll(...args),
  closeCodexExecInSandbox: (...args: unknown[]) => mocks.close(...args),
}));

vi.mock("../providers/hosted-codex-subscription-credentials", () => {
  class HostedCodexSubscriptionError extends Error {
    constructor(
      message: string,
      readonly status = 400,
      readonly code = "hosted_codex_error",
    ) {
      super(message);
      this.name = "HostedCodexSubscriptionError";
    }
  }
  return {
    HostedCodexSubscriptionError,
    claimHostedCodexExecution: (...args: unknown[]) => mocks.claim(...args),
    releaseHostedCodexExecution: (...args: unknown[]) => mocks.release(...args),
    resolveHostedCodexSubscription: (...args: unknown[]) =>
      mocks.resolveHosted(...args),
    decryptHostedMaterial: (...args: unknown[]) => mocks.decrypt(...args),
    updateHostedCodexAuthCache: (...args: unknown[]) =>
      mocks.updateCache(...args),
  };
});

import { OrchestratorError } from "../runtime/orchestrator-request";
import { HostedCodexSubscriptionError } from "../providers/hosted-codex-subscription-credentials";
import {
  buildGen2CodexCommand,
  cancelGen2AgentTurn,
  pollGen2AgentTurn,
  startGen2AgentTurn,
} from "./agent";
import { Gen2LifecycleError } from "./errors";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const chatId = "44444444-4444-4444-8444-444444444444";
const credentialId = "33333333-3333-4333-8333-333333333333";
const AUTH_CACHE = '{"token":"must-not-escape"}';

const turn = {
  workspaceId,
  userId,
  chatId,
  prompt: "List the files",
  idempotencyKey: "turn-1234",
};

describe("gen2 Codex agent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getAgentModel.mockReturnValue("gpt-5.4");
    mocks.requireMember.mockResolvedValue({
      id: workspaceId,
      status: "ready",
      role: "owner",
    });
    mocks.requireChat.mockResolvedValue({
      id: chatId,
      title: "New chat",
    });
    mocks.listMessages.mockResolvedValue([]);
    mocks.appendMessage.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      role: "user",
      body: "List the files",
    });
    mocks.resolveHosted.mockResolvedValue({
      credential: { id: credentialId, encryptedMaterial: "enc" },
    });
    mocks.decrypt.mockResolvedValue({ authCacheJson: AUTH_CACHE });
    mocks.claim.mockResolvedValue(undefined);
    mocks.release.mockResolvedValue(undefined);
    mocks.ensureHostReady.mockResolvedValue(undefined);
    mocks.createTurn.mockResolvedValue(undefined);
    mocks.recordChunks.mockResolvedValue(null);
    mocks.start.mockResolvedValue("session-1");
    mocks.poll.mockResolvedValue({
      chunks: [{ sequence: 0, dataBase64: "e30=" }],
      nextSequence: 1,
      exited: true,
      exitCode: 0,
      codexAuthCacheJson: AUTH_CACHE,
    });
    mocks.close.mockResolvedValue(undefined);
    mocks.updateCache.mockResolvedValue(undefined);
  });

  it("runs Codex with full guest access so the inner sandbox can use the shell", () => {
    const command = buildGen2CodexCommand("List the files");
    expect(command.slice(0, 11)).toEqual([
      "codex",
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--skip-git-repo-check",
      "--sandbox",
      "danger-full-access",
      "-c",
      'approval_policy="never"',
      "--model",
    ]);
    expect(command.at(-1)).toMatch(/List the files/);
    expect(command.at(-1)).toMatch(/Do not inspect CODEX_HOME/);
    expect(command.at(-1)).toMatch(/\/workspace/);
    expect(command.join("\n")).not.toContain(AUTH_CACHE);
  });

  it("starts a turn with the personal cache and returns only a session id", async () => {
    await expect(startGen2AgentTurn(turn)).resolves.toEqual({
      sessionId: "session-1",
    });
    expect(mocks.claim).toHaveBeenCalledWith(credentialId);
    expect(mocks.start).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({
        idempotencyKey: "turn-1234",
        codexAuthCacheJson: AUTH_CACHE,
      }),
    );
    expect(mocks.appendMessage).toHaveBeenCalledWith({
      chatId,
      role: "user",
      body: "List the files",
    });
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("replays this chat's transcript in the next exec prompt", async () => {
    mocks.listMessages.mockResolvedValue([
      { role: "user", body: "hi" },
      { role: "assistant", body: "hello" },
    ]);
    await startGen2AgentTurn(turn);
    const command = mocks.start.mock.calls[0]?.[1] as {
      command: string[];
    };
    expect(command.command.at(-1)).toMatch(/Continue this conversation/);
    expect(command.command.at(-1)).toMatch(/hello/);
    expect(command.command.at(-1)).toMatch(/List the files/);
  });

  it("refuses to start until the instance is ready", async () => {
    mocks.requireMember.mockResolvedValue({
      id: workspaceId,
      status: "pending",
      role: "owner",
    });
    await expect(startGen2AgentTurn(turn)).rejects.toBeInstanceOf(
      Gen2LifecycleError,
    );
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("asks the member to reconnect Codex when there is no personal cache", async () => {
    mocks.resolveHosted.mockResolvedValue(null);
    await expect(startGen2AgentTurn(turn)).rejects.toThrow(/Connect Codex/);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("reattaches when the hosted Codex seat is already claimed", async () => {
    mocks.claim.mockRejectedValue(
      new HostedCodexSubscriptionError("busy", 409, "hosted_codex_busy"),
    );
    await expect(startGen2AgentTurn(turn)).resolves.toEqual({
      sessionId: "session-1",
    });
    expect(mocks.start).toHaveBeenCalled();
    expect(mocks.appendMessage).toHaveBeenCalledWith({
      chatId,
      role: "user",
      body: "List the files",
    });
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("releases a fresh claim when start fails", async () => {
    mocks.start.mockRejectedValue(new OrchestratorError("guest down", 500));
    await expect(startGen2AgentTurn(turn)).rejects.toBeInstanceOf(
      Gen2LifecycleError,
    );
    expect(mocks.release).toHaveBeenCalledWith(credentialId);
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("does not release someone else's busy seat when start fails", async () => {
    mocks.claim.mockRejectedValue(
      new HostedCodexSubscriptionError("busy", 409, "hosted_codex_busy"),
    );
    mocks.start.mockRejectedValue(new OrchestratorError("guest down", 500));
    await expect(startGen2AgentTurn(turn)).rejects.toBeInstanceOf(
      Gen2LifecycleError,
    );
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("retries start once after waking a sleeping host", async () => {
    mocks.start
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce("session-1");
    await expect(startGen2AgentTurn(turn)).resolves.toEqual({
      sessionId: "session-1",
    });
    expect(mocks.ensureHostReady).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("strips the auth cache from poll results and releases the seat on exit", async () => {
    const result = await pollGen2AgentTurn({
      workspaceId,
      userId,
      chatId,
      sessionId: "session-1",
      after: 0,
    });
    expect(result).toEqual({
      chunks: [{ sequence: 0, dataBase64: "e30=" }],
      nextSequence: 1,
      exited: true,
      exitCode: 0,
      reply: null,
      persistedMessageId: null,
    });
    expect(result).not.toHaveProperty("codexAuthCacheJson");
    expect(mocks.updateCache).toHaveBeenCalledWith(credentialId, AUTH_CACHE);
    expect(mocks.release).toHaveBeenCalledWith(credentialId);
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("opens a server-side turn record so the reply outlives the browser", async () => {
    await startGen2AgentTurn({
      workspaceId,
      userId,
      chatId,
      prompt: "List the files",
      idempotencyKey: "idem-0001",
    });
    expect(mocks.createTurn).toHaveBeenCalledWith({
      sessionId: "session-1",
      workspaceId,
      chatId,
      userId,
    });
  });

  it("hands every poll's chunks to the accumulator", async () => {
    await pollGen2AgentTurn({
      workspaceId,
      userId,
      chatId,
      sessionId: "session-1",
      after: 0,
    });
    expect(mocks.recordChunks).toHaveBeenCalledWith({
      sessionId: "session-1",
      chunks: [{ sequence: 0, dataBase64: "e30=" }],
      exited: true,
    });
  });

  it("returns the reply the server persisted on the closing poll", async () => {
    mocks.recordChunks.mockResolvedValue({
      reply: "Here are the files.",
      messageId: "66666666-6666-4666-8666-666666666666",
    });
    const result = await pollGen2AgentTurn({
      workspaceId,
      userId,
      chatId,
      sessionId: "session-1",
      after: 0,
    });
    expect(result.reply).toBe("Here are the files.");
    expect(result.persistedMessageId).toBe(
      "66666666-6666-4666-8666-666666666666",
    );
  });

  it("releases the seat when the turn is gone", async () => {
    mocks.poll.mockRejectedValue(new OrchestratorError("missing", 404));
    await expect(
      pollGen2AgentTurn({
        workspaceId,
        userId,
        sessionId: "session-1",
        after: 0,
      }),
    ).rejects.toThrow(/no longer running/);
    expect(mocks.release).toHaveBeenCalledWith(credentialId);
  });

  it("closes the exec and releases the seat on cancel", async () => {
    await cancelGen2AgentTurn({
      workspaceId,
      userId,
      sessionId: "session-1",
    });
    expect(mocks.close).toHaveBeenCalledWith(workspaceId, "session-1");
    expect(mocks.release).toHaveBeenCalledWith(credentialId);
  });
});
