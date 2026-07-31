import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiError: vi.fn((error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  ),
  getApiUser: vi.fn(),
  getWorkspaceSnapshot: vi.fn(),
  listSandboxFiles: vi.fn(),
  readSandboxFile: vi.fn(),
  readSnapshotFile: vi.fn(),
  requireWorkspacePermission: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: mocks.apiError,
  getApiUser: mocks.getApiUser,
}));
vi.mock("@/lib/access", () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
}));
vi.mock("@/lib/hibernation", () => ({
  getWorkspaceSnapshot: mocks.getWorkspaceSnapshot,
  readSnapshotFile: mocks.readSnapshotFile,
}));
vi.mock("@/lib/orchestrator", () => ({
  OrchestratorError: class OrchestratorError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  listSandboxFiles: mocks.listSandboxFiles,
  readSandboxFile: mocks.readSandboxFile,
}));

import { GET } from "@/app/api/workspaces/[workspaceId]/preview/[[...path]]/route";

describe("workspace preview route", () => {
  it("serves hibernated files from the PostgreSQL snapshot", async () => {
    const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
    mocks.getApiUser.mockResolvedValue({ id: "user-1" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.getWorkspaceSnapshot.mockResolvedValue({
      snapshot: {
        files: [
          {
            path: "index.html",
            mode: "100644",
            contentBase64: "",
          },
        ],
      },
    });
    mocks.readSnapshotFile.mockReturnValue({
      path: "index.html",
      contents: "<html><head></head><body>snapshot</body></html>",
      revision: "snapshot-revision",
    });

    const response = await GET(new Request("https://codev.test/"), {
      params: Promise.resolve({ workspaceId, path: ["index.html"] }),
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(
      `<base href="/api/workspaces/${workspaceId}/preview/">`,
    );
    expect(mocks.readSandboxFile).not.toHaveBeenCalled();
    expect(mocks.listSandboxFiles).not.toHaveBeenCalled();
  });
});
