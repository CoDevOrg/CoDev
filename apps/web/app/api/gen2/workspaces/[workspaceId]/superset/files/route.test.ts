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
vi.mock("@/lib/gen2/superset", () => ({
  listGen2SupersetFiles: mocks.list,
}));

import { GET, maxDuration } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/superset/files`;

describe("Superset files route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.resetAllMocks());

  it("allows the host bridge's file walk time budget", () => {
    expect(maxDuration).toBe(60);
  });

  it("requires a signed-in caller", async () => {
    mocks.getApiUser.mockResolvedValue(null);
    const response = await GET(new Request(`${url}?worktreeId=main`), {
      params,
    });
    expect(response.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("rejects an invalid worktree before reaching the guest", async () => {
    const response = await GET(new Request(`${url}?worktreeId=../escape`), {
      params,
    });
    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("lists the selected Superset worktree", async () => {
    mocks.list.mockResolvedValue([
      { path: "src/greeting.ts", kind: "file", size: 101 },
    ]);
    const response = await GET(new Request(`${url}?worktreeId=main`), {
      params,
    });
    expect(mocks.list).toHaveBeenCalledWith(workspaceId, userId, "main");
    expect(await response.json()).toEqual({
      files: [{ path: "src/greeting.ts", kind: "file", size: 101 }],
    });
  });
});
