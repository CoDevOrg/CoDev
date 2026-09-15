import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveClaudeCliAuth: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/claude-cli-auth", () => ({
  saveClaudeCliAuth: mocks.saveClaudeCliAuth,
}));
vi.mock("@/lib/cli-auth", () => ({
  cliAuthErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : "failed" },
      { status: 401 },
    ),
}));

import { POST } from "@/app/api/cli/claude-auth/route";

const request = () =>
  new Request("https://www.trycodev.com/api/cli/claude-auth", {
    method: "POST",
    body: JSON.stringify({ scopeType: "USER", oauthToken: "fixture" }),
  });

describe("POST /api/cli/claude-auth", () => {
  beforeEach(() => {
    mocks.saveClaudeCliAuth.mockReset();
  });

  // A handler that saved the token but returned nothing made Next.js answer
  // 500, so `codev claude-auth` reported a failure for a connection that worked.
  it("answers the CLI with the saved connection", async () => {
    mocks.saveClaudeCliAuth.mockResolvedValue({
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

  it("renders a failed save through the CLI error response", async () => {
    mocks.saveClaudeCliAuth.mockRejectedValue(new Error("not signed in"));

    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "not signed in" });
  });
});
