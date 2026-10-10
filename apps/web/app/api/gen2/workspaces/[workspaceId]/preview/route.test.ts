import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiUser: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/http/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
  getApiUserAnyAuth: mocks.getApiUser,
}));
vi.mock("@/lib/gen2/workspace-preview", () => ({
  createGen2PreviewSession: mocks.create,
}));

import { Gen2AccessError } from "@/lib/gen2/errors";
import { POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/preview`;
const post = (body: unknown, origin = "https://codev.test") =>
  new Request(url, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("preview session route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: "user-1" });
    mocks.create.mockResolvedValue({
      url: "https://p3000-abc-g1.codev-preview.dev/__codev/preview/session?token=t&next=%2F",
      expiresAt: "2026-10-09T12:01:00.000Z",
    });
  });
  afterEach(() => vi.resetAllMocks());

  it("mints a session for the member with the validated origin and default path", async () => {
    const response = await POST(post({ port: 3000 }), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.create).toHaveBeenCalledWith({
      workspaceId,
      userId: "user-1",
      origin: "https://codev.test",
      request: { port: 3000, path: "/" },
    });
  });

  it.each([
    { port: 0 },
    { port: 70_000 },
    { port: 3000, path: "//evil.example" },
    { port: 3000, path: "/\\evil.example" },
    { port: 3000, path: "https://evil.example/" },
  ])("rejects %j before minting", async (body) => {
    expect((await POST(post(body), { params })).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("requires a signed-in member from the exact app origin", async () => {
    expect(
      (await POST(post({ port: 3000 }, "https://evil.example"), { params }))
        .status,
    ).toBe(403);
    mocks.getApiUser.mockResolvedValueOnce(null);
    expect((await POST(post({ port: 3000 }), { params })).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("passes the viewer rejection through", async () => {
    mocks.create.mockRejectedValueOnce(
      new Gen2AccessError("Only editors can open previews.", 403),
    );
    const response = await POST(post({ port: 3000 }), { params });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only editors can open previews.",
    });
  });
});
