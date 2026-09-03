import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptInvite: vi.fn(),
  consumeRateLimit: vi.fn(),
  createInvite: vi.fn(),
  getApiUser: vi.fn(),
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
  acceptSharedChatInvite: mocks.acceptInvite,
  createSharedChatInvite: mocks.createInvite,
}));

import { POST as acceptInvite } from "@/app/api/room-invites/[token]/accept/route";
import { POST as createInvite } from "@/app/api/rooms/[roomId]/invites/route";
import { SharedChatError } from "@/lib/shared-chat";

describe("shared chat invite routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiUser.mockResolvedValue({ id: "user-1" });
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 19,
      retryAfterSeconds: 0,
    });
    mocks.createInvite.mockResolvedValue({
      id: "invite-1",
      token: "secret-token",
      expiresAt: new Date("2026-09-03T12:00:00.000Z"),
    });
    mocks.acceptInvite.mockResolvedValue("room-123");
  });

  it("creates an absolute invite URL for the owner", async () => {
    const response = await createInvite(
      new Request("https://codev.test/api/rooms/room-123/invites", {
        method: "POST",
      }),
      { params: Promise.resolve({ roomId: "room-123" }) },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      inviteUrl: "https://codev.test/room-invites/secret-token",
      expiresAt: "2026-09-03T12:00:00.000Z",
    });
    expect(mocks.createInvite).toHaveBeenCalledWith("room-123", "user-1");
  });

  it("accepts an invite for an authenticated user", async () => {
    const response = await acceptInvite(
      new Request("https://codev.test/api/room-invites/secret-token/accept", {
        method: "POST",
      }),
      { params: Promise.resolve({ token: "secret-token" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ roomId: "room-123" });
    expect(mocks.acceptInvite).toHaveBeenCalledWith("secret-token", "user-1");
  });

  it("requires authentication on create and accept", async () => {
    mocks.getApiUser.mockResolvedValue(null);
    const createResponse = await createInvite(
      new Request("https://codev.test/api/rooms/room-123/invites", {
        method: "POST",
      }),
      { params: Promise.resolve({ roomId: "room-123" }) },
    );
    const acceptResponse = await acceptInvite(
      new Request("https://codev.test/api/room-invites/token/accept", {
        method: "POST",
      }),
      { params: Promise.resolve({ token: "token" }) },
    );

    expect(createResponse.status).toBe(401);
    expect(acceptResponse.status).toBe(401);
  });

  it("returns room invite lifecycle errors safely", async () => {
    mocks.acceptInvite.mockRejectedValue(
      new SharedChatError("This room invitation is already used.", 400),
    );
    const response = await acceptInvite(
      new Request("https://codev.test/api/room-invites/token/accept", {
        method: "POST",
      }),
      { params: Promise.resolve({ token: "token" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "This room invitation is already used.",
    });
  });

  it("rate limits invite creation before writing", async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 600,
    });
    const response = await createInvite(
      new Request("https://codev.test/api/rooms/room-123/invites", {
        method: "POST",
      }),
      { params: Promise.resolve({ roomId: "room-123" }) },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("600");
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });
});
