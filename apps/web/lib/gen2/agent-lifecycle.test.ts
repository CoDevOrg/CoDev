import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getAccess: vi.fn(),
  workspace: vi.fn(),
  requireChat: vi.fn(),
  listMessages: vi.fn(),
  appendMessage: vi.fn(),
  createTurn: vi.fn(),
  recordChunks: vi.fn(),
  requireTurn: vi.fn(),
  adapterStart: vi.fn(),
  adapterPoll: vi.fn(),
  adapterCancel: vi.fn(),
  adapterRelease: vi.fn(),
}));

vi.mock("../policies/workspace", () => ({
  getWorkspaceAccess: (...args: unknown[]) => mocks.getAccess(...args),
  requireWorkspacePermission: (...args: unknown[]) =>
    mocks.requirePermission(...args),
}));

vi.mock("./workspaces", () => ({
  getGen2WorkspaceForAccess: (...args: unknown[]) => mocks.workspace(...args),
}));

vi.mock("./chats", () => ({
  requireGen2Chat: (...args: unknown[]) => mocks.requireChat(...args),
  listGen2ChatMessages: (...args: unknown[]) => mocks.listMessages(...args),
  appendGen2ChatMessage: (...args: unknown[]) => mocks.appendMessage(...args),
}));

vi.mock("./turns", () => ({
  createGen2Turn: (...args: unknown[]) => mocks.createTurn(...args),
  recordGen2TurnChunks: (...args: unknown[]) => mocks.recordChunks(...args),
  requireGen2Turn: (...args: unknown[]) => mocks.requireTurn(...args),
}));

vi.mock("./instance", () => ({
  describeGen2RuntimeFailure: (error: unknown) =>
    error instanceof Error ? error.message : "runtime failure",
}));

vi.mock("./provider-adapters", () => ({
  getGen2ProviderAdapter: () => ({
    start: (...args: unknown[]) => mocks.adapterStart(...args),
    poll: (...args: unknown[]) => mocks.adapterPoll(...args),
    cancel: (...args: unknown[]) => mocks.adapterCancel(...args),
    release: (...args: unknown[]) => mocks.adapterRelease(...args),
  }),
}));

vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));

import {
  cancelGen2AgentTurn,
  pollGen2AgentTurn,
  startGen2AgentTurn,
} from "./agent";
import { Gen2AccessError, Gen2LifecycleError } from "./errors";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const anotherUserId = "77777777-7777-4777-8777-777777777777";
const chatId = "44444444-4444-4444-8444-444444444444";
const turn = {
  workspaceId,
  userId,
  chatId,
  prompt: "List the files",
  idempotencyKey: "turn-1234",
};

describe("Gen 2 agent lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requirePermission.mockResolvedValue({
      role: "owner",
      capabilities: {},
    });
    mocks.getAccess.mockResolvedValue({ role: "owner", capabilities: {} });
    mocks.workspace.mockResolvedValue({ id: workspaceId, status: "ready" });
    mocks.requireChat.mockResolvedValue({ id: chatId, title: "New chat" });
    mocks.listMessages.mockResolvedValue([]);
    mocks.appendMessage.mockResolvedValue({ id: "message-1" });
    mocks.createTurn.mockResolvedValue(undefined);
    mocks.recordChunks.mockResolvedValue(null);
    mocks.requireTurn.mockResolvedValue({
      workspaceId,
      chatId,
      userId,
      provider: "openai",
      exited: false,
    });
    mocks.adapterStart.mockResolvedValue({ sessionId: "session-1" });
    mocks.adapterPoll.mockResolvedValue({
      chunks: [{ sequence: 0, dataBase64: "e30=" }],
      nextSequence: 1,
      exited: true,
      exitCode: 0,
    });
    mocks.adapterCancel.mockResolvedValue(undefined);
    mocks.adapterRelease.mockResolvedValue(undefined);
  });

  it("authorizes then delegates a selected provider turn", async () => {
    await expect(
      startGen2AgentTurn({ ...turn, provider: "anthropic" }),
    ).resolves.toEqual({ sessionId: "session-1", provider: "anthropic" });
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "agent.run",
    );
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "context.includeInTurn",
    );
    expect(mocks.adapterStart).toHaveBeenCalledWith({
      workspaceId,
      userId,
      prompt: "List the files",
      history: [],
      idempotencyKey: "turn-1234",
    });
    expect(mocks.createTurn).toHaveBeenCalledWith({
      sessionId: "session-1",
      workspaceId,
      chatId,
      userId,
      provider: "anthropic",
    });
  });

  it("defaults legacy starts to OpenAI", async () => {
    await expect(startGen2AgentTurn(turn)).resolves.toEqual({
      sessionId: "session-1",
      provider: "openai",
    });
    expect(mocks.createTurn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai" }),
    );
  });

  it("refuses to start until the workspace is ready", async () => {
    mocks.workspace.mockResolvedValue({ id: workspaceId, status: "pending" });
    await expect(startGen2AgentTurn(turn)).rejects.toBeInstanceOf(
      Gen2LifecycleError,
    );
    expect(mocks.adapterStart).not.toHaveBeenCalled();
  });

  it("delegates polling using the immutable provider on the turn", async () => {
    const result = await pollGen2AgentTurn({
      workspaceId,
      userId: anotherUserId,
      sessionId: "session-1",
      after: 0,
    });
    expect(mocks.adapterPoll).toHaveBeenCalledWith({
      workspaceId,
      turnOwnerId: userId,
      sessionId: "session-1",
      after: 0,
    });
    expect(mocks.recordChunks).toHaveBeenCalledWith({
      sessionId: "session-1",
      chunks: [{ sequence: 0, dataBase64: "e30=" }],
      exited: true,
    });
    expect(result).not.toHaveProperty("codexAuthCacheJson");
  });

  it("returns the reply persisted by the provider-neutral transcript", async () => {
    mocks.recordChunks.mockResolvedValue({
      reply: "Here are the files.",
      messageId: "message-2",
    });
    await expect(
      pollGen2AgentTurn({
        workspaceId,
        userId,
        sessionId: "session-1",
        after: 0,
      }),
    ).resolves.toMatchObject({
      reply: "Here are the files.",
      persistedMessageId: "message-2",
    });
  });

  it("releases the turn's provider when its session no longer exists", async () => {
    mocks.adapterPoll.mockRejectedValue(
      Object.assign(new Error("missing"), { status: 404 }),
    );
    await expect(
      pollGen2AgentTurn({
        workspaceId,
        userId,
        sessionId: "session-1",
        after: 0,
      }),
    ).rejects.toThrow(/no longer running/);
    expect(mocks.adapterRelease).toHaveBeenCalledWith(userId);
  });

  it("authorizes cancellation before delegating it to the initiating provider", async () => {
    await cancelGen2AgentTurn({
      workspaceId,
      userId: anotherUserId,
      sessionId: "session-1",
    });
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      workspaceId,
      anotherUserId,
      "agent.cancelAny",
    );
    expect(mocks.adapterCancel).toHaveBeenCalledWith({
      workspaceId,
      turnOwnerId: userId,
      sessionId: "session-1",
    });
  });

  it("does not let an editor cancel another member's turn", async () => {
    mocks.requirePermission.mockImplementation(
      (_workspaceId: string, _userId: string, permission: string) => {
        if (permission === "agent.cancelAny") {
          throw new Gen2AccessError("forbidden", 403);
        }
      },
    );
    await expect(
      cancelGen2AgentTurn({
        workspaceId,
        userId: anotherUserId,
        sessionId: "session-1",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.adapterCancel).not.toHaveBeenCalled();
  });
});
