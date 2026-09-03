import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  getApiUser: vi.fn(),
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
}));

import { POST } from "@/app/api/rooms/[roomId]/messages/route";
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
      id: "message-1",
      sequence: 2,
      body: "New message",
      authorName: "Qais",
      createdAt: "2026-09-02T12:00:00.000Z",
    });
  });

  it("posts an authenticated room-member message", async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      message: { id: "message-1", body: "New message" },
    });
    expect(mocks.postMessage).toHaveBeenCalledWith({
      roomId: "room-123",
      userId: "user-1",
      authorName: "Qais",
      body: "New message",
    });
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
