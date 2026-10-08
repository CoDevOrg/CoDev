import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  createGen2Chat: vi.fn(),
  listGen2Chats: vi.fn(),
}));

vi.mock("@/lib/http/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
  getApiUserAnyAuth: mocks.getApiUser,
}));

vi.mock("@/lib/gen2/chats", () => ({
  createGen2Chat: mocks.createGen2Chat,
  listGen2Chats: mocks.listGen2Chats,
}));

import { POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/chats`;
const post = (body?: string) =>
  POST(
    new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "https://codev.test",
      },
      ...(body === undefined ? {} : { body }),
    }),
    { params },
  );

describe("gen2 chat creation route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
    mocks.createGen2Chat.mockResolvedValue({ id: "chat-1" });
  });
  afterEach(() => vi.resetAllMocks());

  it("records the agent the chat starts with", async () => {
    const response = await post(JSON.stringify({ provider: "claude" }));

    expect(response.status).toBe(201);
    expect(mocks.createGen2Chat).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "claude",
    );
  });

  it("still creates a chat without a body", async () => {
    expect((await post()).status).toBe(201);
    expect(mocks.createGen2Chat).toHaveBeenCalledWith(
      workspaceId,
      userId,
      undefined,
    );
  });

  it("rejects an unknown agent", async () => {
    expect((await post(JSON.stringify({ provider: "gemini" }))).status).toBe(
      400,
    );
    expect(mocks.createGen2Chat).not.toHaveBeenCalled();
  });
});
