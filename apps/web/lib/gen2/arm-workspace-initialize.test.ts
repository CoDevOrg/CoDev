import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  snapshot: vi.fn(),
  row: {} as Record<string, unknown>,
}));
vi.mock("../runtime/arm-workspace-request", () => ({
  armWorkspaceRequest: mocks.request,
}));
vi.mock("./arm-workspace-private-source", () => ({
  initializeArmPrivateSource: async (
    workspace: Record<string, unknown>,
    database: unknown,
    write: (file: unknown) => Promise<unknown>,
  ) => {
    const snapshot = await mocks.snapshot(
      workspace.ownerId,
      workspace.repository,
      workspace.baseSha,
      database,
    );
    for (const file of snapshot.files) await write(file);
  },
}));
vi.mock("./instance", () => ({
  buildBlankSandboxSource: () => ({
    repositoryUrl: null,
    baseSha: "0".repeat(40),
    repositorySnapshot: {
      files: [{ path: "README.md", mode: "100644", contentBase64: "aGVsbG8=" }],
      totalBytes: 5,
    },
  }),
}));
import { initializeGen2ArmWorkspace } from "./arm-workspace-initialize";
import type { getDatabase } from "../platform/database";
const target = {
  workspaceId: "workspace-a",
  generation: 2,
  host: "runtime.trycodev.com",
};
const db = {
  select: () => ({
    from: () => ({ where: () => ({ limit: async () => [mocks.row] }) }),
  }),
} as unknown as ReturnType<typeof getDatabase>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.row = {
    ownerId: "owner-a",
    repository: "owner/repo",
    repositoryPrivate: true,
    baseSha: "a".repeat(40),
  };
  mocks.request.mockImplementation(async () =>
    Response.json({ initialized: false }),
  );
});
it("reopens saved disks without fetching GitHub credentials or rewriting files", async () => {
  mocks.request
    .mockResolvedValueOnce(Response.json({ running: false }))
    .mockResolvedValueOnce(Response.json({ initialized: true }));
  await initializeGen2ArmWorkspace(db, target);
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.request).toHaveBeenCalledTimes(2);
});
it("sends private repository files through signed requests without a GitHub token", async () => {
  const file = { path: "a.txt", mode: "100644", contentBase64: "aGVsbG8=" };
  mocks.snapshot.mockResolvedValue({ files: [file], totalBytes: 5 });
  mocks.request.mockResolvedValueOnce(Response.json({ running: false }));
  await initializeGen2ArmWorkspace(db, target);
  expect(mocks.snapshot).toHaveBeenCalledWith(
    "owner-a",
    "owner/repo",
    "a".repeat(40),
    db,
  );
  const bodies = mocks.request.mock.calls
    .filter((call) => call[1] === "POST")
    .map((call) => call[3]);
  expect(bodies).toEqual([
    { repositoryUrl: null, baseSha: "a".repeat(40) },
    { repositoryUrl: null, baseSha: "a".repeat(40), file },
    { repositoryUrl: null, baseSha: "a".repeat(40), complete: true },
  ]);
});
it("refuses an image without the agent activity protocol", async () => {
  mocks.request.mockResolvedValueOnce(
    Response.json({ error: "route not found" }, { status: 404 }),
  );
  await expect(initializeGen2ArmWorkspace(db, target)).rejects.toMatchObject({
    code: "GUEST_RUNTIME_UPDATE_REQUIRED",
  });
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
it("fails startup if any snapshot write fails", async () => {
  mocks.snapshot.mockResolvedValue({
    files: [{ path: "a", mode: "100644", contentBase64: "YQ==" }],
    totalBytes: 1,
  });
  mocks.request
    .mockResolvedValueOnce(Response.json({ running: false }))
    .mockResolvedValueOnce(Response.json({ initialized: false }))
    .mockResolvedValueOnce(Response.json({ error: "failed" }, { status: 503 }));
  await expect(initializeGen2ArmWorkspace(db, target)).rejects.toMatchObject({
    code: "WORKSPACE_INITIALIZATION_FAILED",
  });
  expect(mocks.request).toHaveBeenCalledTimes(3);
});
