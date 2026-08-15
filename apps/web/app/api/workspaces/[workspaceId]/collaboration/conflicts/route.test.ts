import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  listCollaborationConflicts: vi.fn(),
  reportCollaborationConflict: vi.fn(),
  ensureWorkspaceRuntimeReady: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
}));
vi.mock("@/lib/access", () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
}));
vi.mock("@/lib/collaboration-server", () => ({
  listCollaborationConflicts: mocks.listCollaborationConflicts,
  reportCollaborationConflict: mocks.reportCollaborationConflict,
}));
vi.mock("@/lib/runtime-resume", () => ({
  ensureWorkspaceRuntimeReady: mocks.ensureWorkspaceRuntimeReady,
}));

import { GET, POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";

describe("workspace collaboration conflicts route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.listCollaborationConflicts.mockResolvedValue([
      {
        worktreeId: "4dbbf95e-08fe-4a6f-84e9-a5d85000da8e",
        path: "src/hello.ts",
        snapshotRevision: "snapshot-r1",
        filesystemRevision: "filesystem-r2",
        collaborativeContents: "export const hello = 'Alex';",
        filesystemContents: "export const hello = 'terminal';",
      },
    ]);
  });

  afterEach(() => vi.resetAllMocks());

  it("returns both preserved versions only after workspace authorization", async () => {
    const response = await GET(new Request("https://codev.test"), {
      params: Promise.resolve({ workspaceId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      conflicts: [
        {
          path: "src/hello.ts",
          collaborativeContents: "export const hello = 'Alex';",
          filesystemContents: "export const hello = 'terminal';",
        },
      ],
    });
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "view",
    );
  });

  it("records a native editor conflict without overwriting either version", async () => {
    mocks.reportCollaborationConflict.mockResolvedValue({
      worktreeId: "4dbbf95e-08fe-4a6f-84e9-a5d85000da8e",
      path: "README.md",
      snapshotRevision: "editor-r1",
      filesystemRevision: "filesystem-r2",
      collaborativeContents: "collaborative README",
      filesystemContents: "terminal README",
    });

    const response = await POST(
      new Request("https://codev.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "README.md",
          collaborativeContents: "collaborative README",
        }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      path: "README.md",
      collaborativeContents: "collaborative README",
      filesystemContents: "terminal README",
    });
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "edit",
    );
    expect(mocks.ensureWorkspaceRuntimeReady).toHaveBeenCalledWith(
      workspaceId,
      userId,
    );
    expect(mocks.reportCollaborationConflict).toHaveBeenCalledWith(
      workspaceId,
      {
        path: "README.md",
        collaborativeContents: "collaborative README",
      },
    );
  });
});
