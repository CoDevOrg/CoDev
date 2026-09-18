import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ClaudeConnectionError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    ClaudeConnectionError,
    getApiUser: vi.fn(),
    saveClaudeConnectionForUser: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/http/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
}));
vi.mock("@/lib/providers/claude-connection", () => ({
  ClaudeConnectionError: mocks.ClaudeConnectionError,
  saveClaudeConnectionForUser: mocks.saveClaudeConnectionForUser,
}));

import { POST } from "@/app/api/personal/claude-connection/route";

const request = () =>
  new Request("https://www.trycodev.com/api/personal/claude-connection", {
    method: "POST",
    body: JSON.stringify({ oauthToken: "fixture" }),
  });

describe("POST /api/personal/claude-connection", () => {
  beforeEach(() => {
    mocks.getApiUser.mockReset().mockResolvedValue({ id: "user-1" });
    mocks.saveClaudeConnectionForUser.mockReset();
  });

  // Saving the connection but returning nothing made Next.js answer 500.
  it("answers with the saved connection", async () => {
    mocks.saveClaudeConnectionForUser.mockResolvedValue({
      scopeType: "USER",
      scopeId: "user-1",
    });

    const response = await POST(request());

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "connected",
      scopeType: "USER",
      scopeId: "user-1",
    });
  });

  it("rejects a signed-out request", async () => {
    mocks.getApiUser.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.saveClaudeConnectionForUser).not.toHaveBeenCalled();
  });

  it("keeps a connection error's own status", async () => {
    mocks.saveClaudeConnectionForUser.mockRejectedValue(
      new mocks.ClaudeConnectionError("organization not found", 404),
    );

    const response = await POST(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "organization not found",
    });
  });
});
