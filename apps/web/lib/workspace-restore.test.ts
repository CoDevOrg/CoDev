import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendWorkspaceEvent: vi.fn(),
  executeInSandbox: vi.fn(),
  getDatabase: vi.fn(),
  requireWorkspacePermission: vi.fn(),
}));

vi.mock("./audit", () => ({
  appendWorkspaceEvent: mocks.appendWorkspaceEvent,
}));
vi.mock("./access", () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
}));
vi.mock("./database", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("./orchestrator", () => ({
  executeInSandbox: mocks.executeInSandbox,
}));

import {
  getWorkspaceFileHistory,
  restoreWorkspaceFile,
  restoreWorkspaceToRevision,
  WorkspaceRestoreError,
} from "./workspace-restore";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function mockIntegrationWorktreeLookup(worktree: {
  id: string;
  headSha: string;
} | null) {
  const query = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(worktree ? [worktree] : []);
  return query;
}

describe("getWorkspaceFileHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.getDatabase.mockReturnValue(
      mockIntegrationWorktreeLookup({ id: "integration-1", headSha: SHA_A }),
    );
  });

  it("requires view permission and parses git log records into entries", async () => {
    mocks.executeInSandbox.mockResolvedValue({
      exitCode: 0,
      output: `${SHA_A}\x1fJordan\x1f2026-08-01T00:00:00Z\x1fFix typo\x1e${SHA_B}\x1fAlex\x1f2026-07-01T00:00:00Z\x1fInitial\x1e`,
    });

    const entries = await getWorkspaceFileHistory(
      "workspace-1",
      "user-1",
      "README.md",
    );

    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      "workspace-1",
      "user-1",
      "view",
    );
    expect(entries).toEqual([
      {
        revision: SHA_A,
        author: "Jordan",
        date: "2026-08-01T00:00:00Z",
        message: "Fix typo",
      },
      {
        revision: SHA_B,
        author: "Alex",
        date: "2026-07-01T00:00:00Z",
        message: "Initial",
      },
    ]);
    expect(mocks.executeInSandbox).toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({ worktreeId: "integration-1" }),
    );
  });

  it("rejects a path containing traversal segments before touching the sandbox", async () => {
    await expect(
      getWorkspaceFileHistory("workspace-1", "user-1", "../secrets"),
    ).rejects.toThrow(WorkspaceRestoreError);
    expect(mocks.executeInSandbox).not.toHaveBeenCalled();
  });

  it("surfaces a git failure as a restore error", async () => {
    mocks.executeInSandbox.mockResolvedValue({
      exitCode: 128,
      output: "fatal: no such path",
    });
    await expect(
      getWorkspaceFileHistory("workspace-1", "user-1", "missing.txt"),
    ).rejects.toThrow("fatal: no such path");
  });
});

describe("restoreWorkspaceFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.getDatabase.mockReturnValue(
      mockIntegrationWorktreeLookup({ id: "integration-1", headSha: SHA_A }),
    );
    mocks.appendWorkspaceEvent.mockResolvedValue({ id: "event-1" });
  });

  it("checks out the file at the given revision and logs a restore event", async () => {
    mocks.executeInSandbox.mockResolvedValue({ exitCode: 0, output: "" });

    const result = await restoreWorkspaceFile("workspace-1", "user-1", {
      path: "src/index.ts",
      revision: SHA_A,
    });

    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      "workspace-1",
      "user-1",
      "edit",
    );
    expect(mocks.executeInSandbox).toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({
        command: ["git", "--no-pager", "-c", "color.ui=never", "checkout", SHA_A, "--", "src/index.ts"],
        worktreeId: "integration-1",
      }),
    );
    expect(mocks.appendWorkspaceEvent).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      actorId: "user-1",
      type: "file.restored",
      payload: {
        path: "src/index.ts",
        revision: SHA_A,
        worktreeId: "integration-1",
      },
    });
    expect(result).toEqual({ path: "src/index.ts", revision: SHA_A });
  });

  it("rejects an invalid revision without ever reaching the sandbox", async () => {
    await expect(
      restoreWorkspaceFile("workspace-1", "user-1", {
        path: "src/index.ts",
        revision: "not-a-sha",
      }),
    ).rejects.toThrow(WorkspaceRestoreError);
    expect(mocks.executeInSandbox).not.toHaveBeenCalled();
    expect(mocks.appendWorkspaceEvent).not.toHaveBeenCalled();
  });

  it("does not log an event when the checkout fails", async () => {
    mocks.executeInSandbox.mockResolvedValue({
      exitCode: 1,
      output: "error: pathspec did not match",
    });
    await expect(
      restoreWorkspaceFile("workspace-1", "user-1", {
        path: "src/index.ts",
        revision: SHA_A,
      }),
    ).rejects.toThrow("error: pathspec did not match");
    expect(mocks.appendWorkspaceEvent).not.toHaveBeenCalled();
  });
});

describe("restoreWorkspaceToRevision", () => {
  let updateQuery: { set: ReturnType<typeof vi.fn>; where: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.appendWorkspaceEvent.mockResolvedValue({ id: "event-1" });

    const selectQuery = mockIntegrationWorktreeLookup({
      id: "integration-1",
      headSha: SHA_A,
    });
    updateQuery = { set: vi.fn(), where: vi.fn().mockResolvedValue(undefined) };
    updateQuery.set.mockReturnValue(updateQuery);
    mocks.getDatabase.mockReturnValue({
      select: selectQuery.select,
      from: selectQuery.from,
      where: selectQuery.where,
      limit: selectQuery.limit,
      update: vi.fn(() => updateQuery),
    });
  });

  it("requires merge permission, backs up HEAD, hard-resets, and records the previous sha", async () => {
    mocks.executeInSandbox
      .mockResolvedValueOnce({ exitCode: 0, output: `${SHA_A}\n` }) // rev-parse HEAD
      .mockResolvedValueOnce({ exitCode: 0, output: "" }) // branch backup
      .mockResolvedValueOnce({ exitCode: 0, output: "" }); // reset --hard

    const result = await restoreWorkspaceToRevision("workspace-1", "user-1", {
      revision: SHA_B,
    });

    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      "workspace-1",
      "user-1",
      "merge",
    );
    expect(mocks.executeInSandbox).toHaveBeenNthCalledWith(
      3,
      "workspace-1",
      expect.objectContaining({
        command: ["git", "--no-pager", "-c", "color.ui=never", "reset", "--hard", SHA_B],
        worktreeId: "integration-1",
      }),
    );
    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({ headSha: SHA_B }),
    );
    expect(mocks.appendWorkspaceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "workspace.restored",
        payload: expect.objectContaining({
          revision: SHA_B,
          previousHeadSha: SHA_A,
        }),
      }),
    );
    expect(result.previousHeadSha).toBe(SHA_A);
    expect(result.backupBranch).toMatch(/^codev-restore-backup\//);
  });

  it("does not reset when the backup branch could not be created", async () => {
    mocks.executeInSandbox
      .mockResolvedValueOnce({ exitCode: 0, output: `${SHA_A}\n` }) // rev-parse HEAD
      .mockResolvedValueOnce({ exitCode: 128, output: "fatal: lock held" }); // branch backup fails

    await expect(
      restoreWorkspaceToRevision("workspace-1", "user-1", { revision: SHA_B }),
    ).rejects.toThrow("fatal: lock held");
    expect(mocks.executeInSandbox).toHaveBeenCalledTimes(2);
    expect(updateQuery.set).not.toHaveBeenCalled();
    expect(mocks.appendWorkspaceEvent).not.toHaveBeenCalled();
  });
});
