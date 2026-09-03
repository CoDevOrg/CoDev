import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  createSharedChat: vi.fn(),
  getApiUser: vi.fn(),
  previewChatGptShare: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status },
    ),
  getApiUser: mocks.getApiUser,
}));
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock("@/lib/shared-chat", () => ({
  createSharedChatFromImportedConversation: mocks.createSharedChat,
}));
vi.mock("@/lib/conversation-import/chatgpt-share-fetch", () => ({
  ChatGptShareFetchError: class ChatGptShareFetchError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  previewChatGptShare: mocks.previewChatGptShare,
}));

import { POST } from "@/app/api/conversation-imports/route";

const shareUrl = "https://chatgpt.com/share/share-123";
const conversation = {
  source: {
    provider: "chatgpt",
    externalId: "share-123",
    url: shareUrl,
    model: null,
    updatedAt: null,
  },
  title: "Imported chat",
  messages: [
    {
      sequence: 0,
      role: "user",
      authorName: "User",
      text: "Question",
      sourceContentType: "text",
      createdAt: null,
      artifacts: [],
    },
  ],
  warnings: [],
};

function request(body: unknown = { url: shareUrl }) {
  return new Request("https://codev.test/api/conversation-imports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("conversation import creation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiUser.mockResolvedValue({ id: "user-1" });
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      retryAfterSeconds: 0,
    });
    mocks.previewChatGptShare.mockResolvedValue(conversation);
    mocks.createSharedChat.mockResolvedValue({
      roomId: "room-123",
      conversationId: "conversation-123",
      created: true,
    });
  });

  it("re-fetches, persists, and returns the new room", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      room: { id: "room-123", href: "/rooms/room-123" },
      created: true,
    });
    expect(mocks.previewChatGptShare).toHaveBeenCalledWith(shareUrl);
    expect(mocks.createSharedChat).toHaveBeenCalledWith("user-1", conversation);
  });

  it("returns an existing room idempotently", async () => {
    mocks.createSharedChat.mockResolvedValue({
      roomId: "room-existing",
      conversationId: "conversation-existing",
      created: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      room: { href: "/rooms/room-existing" },
      created: false,
    });
  });

  it("requires authentication and rate limits before fetching", async () => {
    mocks.getApiUser.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);

    mocks.getApiUser.mockResolvedValue({ id: "user-1" });
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 300,
    });
    const limited = await POST(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("300");
    expect(mocks.previewChatGptShare).not.toHaveBeenCalled();
  });

  it("rejects invalid input without persisting it", async () => {
    const response = await POST(request({ url: "not-a-url" }));

    expect(response.status).toBe(400);
    expect(mocks.previewChatGptShare).not.toHaveBeenCalled();
    expect(mocks.createSharedChat).not.toHaveBeenCalled();
  });

  it("does not expose unexpected persistence errors", async () => {
    mocks.createSharedChat.mockRejectedValue(new Error("database secret"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "The collaborative room could not be created.",
    });
  });
});
