import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  snapshot: vi.fn(),
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
vi.mock("@/lib/gen2/home-snapshot", () => ({
  getGen2HomeSnapshot: mocks.snapshot,
}));

import { GET } from "./route";

const call = () =>
  GET(new Request("https://codev.test/api/gen2/home"), {
    params: Promise.resolve({}),
  });

describe("workspace home route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: "user-1" });
  });
  afterEach(() => vi.resetAllMocks());

  it("requires sign-in", async () => {
    mocks.getApiUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("returns only the signed-in member's snapshot, uncached", async () => {
    mocks.snapshot.mockResolvedValue({ workspaces: [], compute: {} });
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ workspaces: [], compute: {} });
    expect(mocks.snapshot).toHaveBeenCalledWith("user-1");
  });
});
