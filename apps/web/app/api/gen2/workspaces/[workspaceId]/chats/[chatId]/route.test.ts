import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  renameGen2Chat: vi.fn(),
  getGen2ChatDetail: vi.fn(),
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
  getGen2ChatDetail: mocks.getGen2ChatDetail,
  renameGen2Chat: mocks.renameGen2Chat,
}));

import { PATCH } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const chatId = "4d6e8b10-2c4a-4f1e-9a77-0b1c2d3e4f50";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId, chatId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/chats/${chatId}`;

describe("gen2 chat route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.resetAllMocks());

  it("renames a chat with a trimmed title", async () => {
    const chat = {
      id: chatId,
      title: "Auth notes",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    mocks.renameGen2Chat.mockResolvedValue(chat);

    const response = await PATCH(
      new Request(url, {
        method: "PATCH",
        headers: {
          origin: "https://codev.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "  Auth notes  " }),
      }),
      { params },
    );

    expect(mocks.renameGen2Chat).toHaveBeenCalledWith(
      workspaceId,
      chatId,
      userId,
      "Auth notes",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ chat });
  });

  it("rejects an empty title", async () => {
    const response = await PATCH(
      new Request(url, {
        method: "PATCH",
        headers: {
          origin: "https://codev.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "   " }),
      }),
      { params },
    );

    expect(response.status).toBe(400);
    expect(mocks.renameGen2Chat).not.toHaveBeenCalled();
  });
});
