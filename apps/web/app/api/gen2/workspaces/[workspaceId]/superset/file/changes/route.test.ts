import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  listChanges: vi.fn(),
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
  listGen2SupersetExternalFileChanges: mocks.listChanges,
}));

import { GET, maxDuration } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/superset/file/changes`;

describe("Superset external file changes route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.resetAllMocks());

  it("allows the private host watcher time budget", () => {
    expect(maxDuration).toBe(60);
  });

  it("requires sign-in before draining host changes", async () => {
    mocks.getApiUser.mockResolvedValue(null);
    const response = await GET(new Request(`${url}?worktreeId=main`), {
      params,
    });
    expect(response.status).toBe(401);
    expect(mocks.listChanges).not.toHaveBeenCalled();
  });

  it("returns revisioned external changes for the selected worktree", async () => {
    mocks.listChanges.mockResolvedValue([
      {
        type: "file.changed",
        worktreeId: "main",
        path: "src/greeting.ts",
        revision: "rev-2",
        origin: "external",
      },
    ]);
    const response = await GET(new Request(`${url}?worktreeId=main`), {
      params,
    });
    expect(mocks.listChanges).toHaveBeenCalledWith(workspaceId, userId, "main");
    expect(await response.json()).toMatchObject({
      changes: [{ path: "src/greeting.ts", revision: "rev-2" }],
    });
  });
});
