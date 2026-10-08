import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  createShareLink: vi.fn(),
  getActiveShare: vi.fn(),
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

vi.mock("@/lib/gen2/workspaces", () => ({
  createGen2ShareLink: mocks.createShareLink,
  getGen2ActiveShare: mocks.getActiveShare,
}));

import { GET, POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/share`;

describe("gen2 share route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.resetAllMocks());

  it("rejects owner links instead of creating a single-use ownership invitation", async () => {
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          origin: "https://codev.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "owner" }),
      }),
      { params },
    );
    expect(response.status).toBe(400);
    expect(mocks.createShareLink).not.toHaveBeenCalled();
  });

  it("creates a share link with the specified role", async () => {
    mocks.createShareLink.mockResolvedValue({
      inviteUrl: "https://codev.test/gen2/join/tok-1",
      role: "viewer",
    });

    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          origin: "https://codev.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "viewer" }),
      }),
      { params },
    );

    expect(mocks.createShareLink).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "https://codev.test",
      "viewer",
    );
    expect(await response.json()).toEqual({
      inviteUrl: "https://codev.test/gen2/join/tok-1",
      role: "viewer",
    });
  });

  it("retrieves the active share link details", async () => {
    mocks.getActiveShare.mockResolvedValue({
      role: "editor",
      expiresAt: "2026-10-08T00:00:00.000Z",
    });

    const response = await GET(new Request(url), { params });

    expect(mocks.getActiveShare).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "https://codev.test",
    );
    expect(await response.json()).toEqual({
      role: "editor",
      expiresAt: "2026-10-08T00:00:00.000Z",
    });
  });
});
