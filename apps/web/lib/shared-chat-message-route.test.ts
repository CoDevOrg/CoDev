import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  getApiUser: vi.fn(),
  listMessages: vi.fn(),
  postMessage: vi.fn(),
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
  SharedChatError: class SharedChatError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  postSharedChatMessage: mocks.postMessage,
  listSharedChatMessages: mocks.listMessages,
}));

import { GET, POST } from "@/app/api/rooms/[roomId]/messages/route";
import { SharedChatError } from "@/lib/shared-chat";

const context = { params: Promise.resolve({ roomId: "room-123" }) };

function request(body: unknown = { body: "New message" }) {
  return new Request("https://codev.test/api/rooms/room-123/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("shared chat message route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiUser.mockResolvedValue({
      id: "user-1",
      name: "Qais",
      githubLogin: "qais",
    });
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 59,
      retryAfterSeconds: 0,
    });
    mocks.postMessage.mockResolvedValue({
      sequence: 2,
      role: "user",
      authorName: "Qais",
      text: "New message",
      sourceContentType: "text",
      createdAt: "2026-09-02T12:00:00.000Z",
      artifacts: [],
    });
    mocks.listMessages.mockResolvedValue([
      {
        sequence: 3,
        role: "user",
        authorName: "Jordan",
        text: "Live reply",
        sourceContentType: "text",
        createdAt: "2026-09-02T12:01:00.000Z",
        artifacts: [],
      },
    ]);
  });

  it("posts an authenticated room-member message", async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      message: { sequence: 2, text: "New message" },
    });
    expect(mocks.postMessage).toHaveBeenCalledWith({
      roomId: "room-123",
      userId: "user-1",
      authorName: "Qais",
      body: "New message",
    });
  });

  it("returns messages after the requested cursor for room members", async () => {
    const response = await GET(
      new Request("https://codev.test/api/rooms/room-123/messages?after=2"),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      messages: [{ sequence: 3, text: "Live reply" }],
    });
    expect(mocks.listMessages).toHaveBeenCalledWith("room-123", "user-1", 2);
  });

  it("rejects an invalid live-message cursor", async () => {
    const response = await GET(
      new Request("https://codev.test/api/rooms/room-123/messages?after=bad"),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.listMessages).not.toHaveBeenCalled();
  });

  it("requires authentication before rate limiting", async () => {
    mocks.getApiUser.mockResolvedValue(null);

    const response = await POST(request(), context);

    expect(response.status).toBe(401);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("rejects empty and oversized messages", async () => {
    for (const body of [{ body: "   " }, { body: "x".repeat(20_001) }]) {
      const response = await POST(request(body), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.postMessage).not.toHaveBeenCalled();
  });

  it("returns membership errors safely", async () => {
    mocks.postMessage.mockRejectedValue(
      new SharedChatError("You cannot post messages in this room.", 403),
    );

    const response = await POST(request(), context);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "You cannot post messages in this room.",
    });
  });

  it("rate limits before validating and writing", async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 120,
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(mocks.postMessage).not.toHaveBeenCalled();
  });
});
