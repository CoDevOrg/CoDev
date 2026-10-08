import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
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
  listGen2SupersetWorktrees: mocks.list,
  createGen2SupersetWorktree: mocks.create,
}));

import { GET, POST, maxDuration } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/superset/worktrees`;

describe("Superset worktrees route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.resetAllMocks());

  it("keeps the host bridge's workspace operation time budget", () => {
    expect(maxDuration).toBe(60);
  });

  it("lists selectable worktrees", async () => {
    mocks.list.mockResolvedValue([{ worktreeId: "main", branch: "main" }]);
    const response = await GET(new Request(url), { params });
    expect(mocks.list).toHaveBeenCalledWith(workspaceId, userId);
    expect(await response.json()).toEqual({
      worktrees: [{ worktreeId: "main", branch: "main" }],
    });
  });

  it("validates a worktree before creating it", async () => {
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          origin: "https://codev.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ worktreeId: "../escape", branch: "codev/a" }),
      }),
      { params },
    );
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates a branch worktree through the authorized library", async () => {
    const worktree = { worktreeId: "agent-a", branch: "codev/agent-a" };
    mocks.create.mockResolvedValue(worktree);
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          origin: "https://codev.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...worktree, baseRef: "HEAD" }),
      }),
      { params },
    );
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(workspaceId, userId, {
      ...worktree,
      baseRef: "HEAD",
    });
    expect(await response.json()).toEqual({ worktree });
  });
});
