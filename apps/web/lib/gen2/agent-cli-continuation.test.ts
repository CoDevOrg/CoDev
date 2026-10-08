import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  turn: null as Record<string, unknown> | null,
  updated: [] as unknown[],
  models: vi.fn(),
  start: vi.fn(),
  append: vi.fn(),
  list: vi.fn(),
  record: vi.fn(),
  blocked: vi.fn(),
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (mocks.turn ? [mocks.turn] : []) }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => mocks.updated.push(values),
      }),
    }),
  }),
}));
vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));
vi.mock("../providers/dynamic-models", () => ({
  getDynamicModelsForProvider: mocks.models,
}));
vi.mock("./agent", () => ({ startGen2AgentTurn: mocks.start }));
vi.mock("./chats", () => ({
  appendGen2ChatMessage: mocks.append,
  listGen2ChatMessages: mocks.list,
}));
vi.mock("./agent-cli-fallback", async (original) => ({
  ...(await original<typeof import("./agent-cli-fallback")>()),
  recordCliModelRequirement: mocks.record,
  blockedCliModels: mocks.blocked,
}));

import { continueOnFallbackModel } from "./agent-cli-continuation";

const requirement = { observedVersion: "2.1.236", minVersion: "2.1.280" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.updated = [];
  mocks.turn = {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    userId: "user-1",
    provider: "claude",
    model: "claude-opus-5-5",
    worktreeId: "feature",
  };
  mocks.models.mockResolvedValue([
    { id: "claude-opus-5-5", label: "Opus 5.5" },
    { id: "claude-opus-5-1", label: "Opus 5.1" },
  ]);
  mocks.blocked.mockResolvedValue(new Map([["claude-opus-5-5", requirement]]));
  mocks.list.mockResolvedValue([
    { role: "user", body: "earlier" },
    { role: "assistant", body: "earlier reply" },
    { role: "user", body: "Refactor the parser" },
  ]);
  mocks.start.mockResolvedValue({ sessionId: "session-2" });
});

it("re-runs the latest prompt on the closest supported model and links the turns", async () => {
  expect(await continueOnFallbackModel("session-1", requirement)).toBe(
    "session-2",
  );
  expect(mocks.record).toHaveBeenCalledWith({
    provider: "claude",
    model: "claude-opus-5-5",
    requirement,
  });
  expect(mocks.start).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: "Refactor the parser",
      model: "claude-opus-5-1",
      worktreeId: "feature",
      idempotencyKey: "session-1:cli-fallback",
      continuation: {
        history: [
          { role: "user", body: "earlier" },
          { role: "assistant", body: "earlier reply" },
        ],
      },
    }),
  );
  expect(mocks.append).toHaveBeenCalledWith(
    expect.objectContaining({
      role: "assistant",
      body: expect.stringContaining("Answering with claude-opus-5-1"),
    }),
  );
  expect(mocks.updated).toEqual([{ continuedAsSessionId: "session-2" }]);
});

it("explains instead of failing silently when no fallback can start", async () => {
  mocks.start.mockRejectedValue(new Error("guest unavailable"));
  expect(await continueOnFallbackModel("session-1", requirement)).toBeNull();
  expect(mocks.append).toHaveBeenCalledTimes(1);
  expect(mocks.append).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.stringContaining("No other model on your account"),
    }),
  );
  expect(mocks.updated).toEqual([]);
});

it("leaves turns from before model tracking alone", async () => {
  mocks.turn = { ...mocks.turn, model: null };
  expect(await continueOnFallbackModel("session-1", requirement)).toBeNull();
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
});
