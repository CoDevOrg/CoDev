import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireChat: vi.fn(),
  list: vi.fn(),
  append: vi.fn(),
}));

vi.mock("./chats", () => ({
  requireGen2Chat: (...args: unknown[]) => mocks.requireChat(...args),
  listGen2ChatMessages: (...args: unknown[]) => mocks.list(...args),
  appendGen2ChatMessage: (...args: unknown[]) => mocks.append(...args),
}));

import { applyGen2GoalControl } from "./agent-goal-control";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const chatId = "44444444-4444-4444-8444-444444444444";

describe("goal control", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireChat.mockResolvedValue({ id: chatId });
    mocks.list.mockResolvedValue([
      { role: "user", body: "/goal Ship the parser" },
      { role: "assistant", body: "Working on it." },
    ]);
    mocks.append.mockResolvedValue({ id: "message-1" });
  });

  it("records `/goal done` and returns the achieved goal", async () => {
    await expect(
      applyGen2GoalControl({ workspaceId, chatId, prompt: "/goal done" }),
    ).resolves.toEqual({
      goal: { text: "Ship the parser", status: "achieved", summary: null },
    });
    expect(mocks.requireChat).toHaveBeenCalledWith(workspaceId, chatId);
    expect(mocks.append).toHaveBeenCalledWith({
      chatId,
      role: "user",
      body: "/goal done",
    });
  });

  it("clears the goal with `/goal clear`", async () => {
    await expect(
      applyGen2GoalControl({ workspaceId, chatId, prompt: "/goal clear" }),
    ).resolves.toEqual({ goal: null });
  });

  it("writes nothing to a chat outside the workspace", async () => {
    mocks.requireChat.mockRejectedValue(new Error("Chat not found."));
    await expect(
      applyGen2GoalControl({ workspaceId, chatId, prompt: "/goal done" }),
    ).rejects.toThrow("Chat not found.");
    expect(mocks.append).not.toHaveBeenCalled();
  });
});
