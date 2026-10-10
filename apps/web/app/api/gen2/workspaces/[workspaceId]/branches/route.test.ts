import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  list: vi.fn(),
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
vi.mock("@/lib/gen2/remote-branches", () => ({
  listGen2RemoteBranches: mocks.list,
}));

import { GET } from "./route";

const call = () =>
  GET(new Request("https://codev.test/api/gen2/workspaces/ws-1/branches"), {
    params: Promise.resolve({ workspaceId: "ws-1" }),
  });

describe("workspace branches route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: "user-1" });
  });
  afterEach(() => vi.resetAllMocks());

  it("requires sign-in", async () => {
    mocks.getApiUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("lists branches for the signed-in member, uncached", async () => {
    mocks.list.mockResolvedValue({
      branches: [{ name: "main" }],
      defaultBranch: "main",
      truncated: false,
      unavailable: null,
    });
    const response = await call();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as { branches: unknown };
    expect(body.branches).toEqual([{ name: "main" }]);
    expect(mocks.list).toHaveBeenCalledWith("ws-1", "user-1");
  });
});
