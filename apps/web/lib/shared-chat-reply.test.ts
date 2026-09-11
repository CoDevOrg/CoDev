import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  set: vi.fn(),
  resolve: vi.fn(),
  models: vi.fn(),
  validate: vi.fn(),
  generate: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  claimCodex: vi.fn(),
  releaseCodex: vi.fn(),
  room: vi.fn(),
  ready: vi.fn(),
  provision: vi.fn(),
  start: vi.fn(),
  poll: vi.fn(),
  close: vi.fn(),
  destroy: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./database", () => {
  const query = () => ({
    limit: async () => mocks.rows.shift() ?? [],
    orderBy: () => ({ limit: async () => mocks.rows.shift() ?? [] }),
  });
  const database = {
    select: () => ({ from: () => ({ where: query }) }),
    update: () => ({
      set: (value: unknown) => {
        mocks.set(value);
        return { where: async () => {} };
      },
    }),
  };
  return {
    getDatabase: () => ({
      ...database,
      transaction: async (
        callback: (transaction: typeof database) => unknown,
      ) => callback(database),
    }),
  };
});
vi.mock("./credentials", () => ({
  resolvePersonalChatSubscription: mocks.resolve,
}));
vi.mock("./ai-model", () => ({
  createAgentModel: () => "model",
  getSelectableAgentModels: mocks.models,
  resolveSelectableAgentModel: mocks.validate,
}));
vi.mock("ai", () => ({ generateText: mocks.generate }));
vi.mock("./claude-subscription-execution", () => ({
  claimClaudeSubscriptionExecution: mocks.claim,
  releaseClaudeSubscriptionExecution: mocks.release,
}));
vi.mock("./hosted-codex-subscription-credentials", () => ({
  claimHostedCodexExecution: mocks.claimCodex,
  releaseHostedCodexExecution: mocks.releaseCodex,
  updateHostedCodexAuthCache: mocks.refresh,
}));
vi.mock("./shared-chat", () => ({
  getSharedChatRoom: mocks.room,
  SharedChatError: class extends Error {},
}));
vi.mock("./orchestrator", () => ({
  ensureHostReady: mocks.ready,
  provisionSandbox: mocks.provision,
  startCodexExecInSandbox: mocks.start,
  pollCodexExecInSandbox: mocks.poll,
  closeCodexExecInSandbox: mocks.close,
  destroySandbox: mocks.destroy,
}));

import {
  prepareRoomReply,
  cleanupRoomReply,
  pollRoomReply,
  finishRoomReply,
  roomReplyOptions,
} from "./shared-chat-reply";

const pending = (provider: "claude" | "codex" = "claude") => ({
  id: "reply",
  conversationId: "conversation",
  sequence: 3,
  metadata: {
    roomId: "room",
    requestedBy: "sender",
    generation: { provider, model: "chosen-model", status: "pending" },
  },
});
const history = [
  { role: "user", body: "Continue", authorName: "Sender", metadata: {} },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rows.length = 0;
  mocks.resolve.mockResolvedValue({
    provider: "anthropic",
    source: "USER",
    authType: "OAUTH_TOKEN",
    credentialId: "seat",
    apiKeyOrToken: "private-token",
  });
  mocks.room.mockResolvedValue({ id: "room" });
  mocks.generate.mockResolvedValue({ text: "Answer" });
  mocks.models.mockResolvedValue(["chosen-model"]);
  mocks.start.mockResolvedValue("exec");
});

describe("room replies", () => {
  it("uses the requester account and persists a Claude reply before releasing its lease", async () => {
    mocks.rows.push([pending()], history, [pending()]);
    await prepareRoomReply("reply");
    expect(mocks.resolve).toHaveBeenCalledWith("sender", "claude");
    expect(mocks.room).toHaveBeenCalledWith("room", "sender");
    expect(mocks.claim).toHaveBeenCalledWith("seat");
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Continue"),
        maxRetries: 0,
      }),
    );
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Answer",
        metadata: expect.objectContaining({
          generation: expect.objectContaining({ status: "completed" }),
        }),
      }),
    );
    expect(mocks.release).toHaveBeenCalledWith("seat");
  });
  it("releases the Claude lease when inference fails", async () => {
    mocks.rows.push([pending()], history);
    mocks.generate.mockRejectedValue(new Error("provider failure"));
    await expect(prepareRoomReply("reply")).rejects.toThrow("provider failure");
    expect(mocks.release).toHaveBeenCalledWith("seat");
  });
  it("does not generate or release another turn's busy lease", async () => {
    mocks.rows.push([pending()], history);
    mocks.claim.mockRejectedValue(new Error("busy"));
    await expect(prepareRoomReply("reply")).rejects.toThrow("busy");
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it("rechecks revoked membership and expired credentials before generation", async () => {
    mocks.rows.push([pending()]);
    mocks.room.mockResolvedValue(null);
    await expect(prepareRoomReply("reply")).rejects.toThrow("revoked");
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.room.mockResolvedValue({ id: "room" });
    mocks.rows.push([pending()]);
    mocks.resolve.mockRejectedValue(new Error("expired"));
    await expect(prepareRoomReply("reply")).rejects.toThrow("expired");
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("uses the AI SDK for OAuth Codex", async () => {
    mocks.resolve.mockResolvedValue({
      provider: "openai",
      authType: "OAUTH_TOKEN",
      source: "USER",
      credentialId: "seat",
      apiKeyOrToken: "private",
    });
    mocks.rows.push([pending("codex")], history, [pending("codex")]);
    await prepareRoomReply("reply");
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.provision).not.toHaveBeenCalled();
  });
  it("starts hosted Codex in a separate read-only sandbox without returning secrets", async () => {
    mocks.resolve.mockResolvedValue({
      provider: "openai",
      authType: "HOSTED_CODEX_SUBSCRIPTION",
      source: "USER",
      credentialId: "seat",
      codexAuthCacheJson: "private-cache",
    });
    mocks.rows.push([pending("codex")], history);
    expect(await prepareRoomReply("reply")).toEqual({
      sessionId: "exec",
      credentialId: "seat",
    });
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "reply", repositoryUrl: null }),
    );
    expect(mocks.start).toHaveBeenCalledWith(
      "reply",
      expect.objectContaining({
        command: expect.arrayContaining(["read-only", "chosen-model"]),
        idempotencyKey: "reply",
      }),
    );
  });
  it("cleans up when provisioning fails", async () => {
    mocks.resolve.mockResolvedValue({
      provider: "openai",
      authType: "HOSTED_CODEX_SUBSCRIPTION",
      credentialId: "seat",
      codexAuthCacheJson: "cache",
    });
    mocks.rows.push([pending("codex")], history);
    mocks.provision.mockRejectedValue(new Error("provision failed"));
    await expect(prepareRoomReply("reply")).rejects.toThrow();
    expect(mocks.destroy).toHaveBeenCalledWith("reply");
    expect(mocks.releaseCodex).toHaveBeenCalledWith("seat");
  });
  it("still destroys the sandbox and releases the seat if process cleanup fails", async () => {
    mocks.close.mockRejectedValue(new Error("close failed"));
    await expect(cleanupRoomReply("reply", "seat", "exec")).rejects.toThrow();
    expect(mocks.destroy).toHaveBeenCalledWith("reply");
    expect(mocks.releaseCodex).toHaveBeenCalledWith("seat");
  });
  it("stores refreshed auth without including it in workflow results", async () => {
    mocks.poll.mockResolvedValue({
      chunks: [],
      nextSequence: 5,
      exited: true,
      exitCode: 0,
      codexAuthCacheJson: "secret-cache",
    });
    expect(await pollRoomReply("reply", "exec", "seat", 0)).not.toHaveProperty(
      "codexAuthCacheJson",
    );
    expect(mocks.refresh).toHaveBeenCalledWith("seat", "secret-cache");
  });
  it("never overwrites a completed reply on replay", async () => {
    const message = pending();
    message.metadata.generation.status = "completed";
    mocks.rows.push([message]);
    await finishRoomReply("reply", "failure", true);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("returns only public connection and model choices", async () => {
    const result = await roomReplyOptions("sender");
    expect(result).toEqual([
      { provider: "claude", models: ["chosen-model"] },
      { provider: "codex", models: ["chosen-model"] },
    ]);
    expect(JSON.stringify(result)).not.toContain("private-token");
  });
});
