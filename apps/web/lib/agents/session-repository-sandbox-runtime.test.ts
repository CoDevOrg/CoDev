import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSandboxWorktree: vi.fn(),
  deleteSandboxWorktree: vi.fn(),
  executeInSandbox: vi.fn(),
  restoreSandboxSession: vi.fn(),
}));

vi.mock("../runtime/orchestrator", () => mocks);
vi.mock("../platform/database", () => ({ getDatabase: vi.fn() }));

import { SandboxSessionRepositoryRuntime } from "./session-repository-sandbox-runtime";

describe("sandbox session repository runtime", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes only declared repository files to the dedicated restore operation", async () => {
    mocks.restoreSandboxSession.mockResolvedValue({
      status: "conflicted",
      conflictPaths: ["src/app.ts"],
    });
    const runtime = new SandboxSessionRepositoryRuntime({} as never);
    const contents = new Uint8Array([0, 1, 255]);

    await expect(
      runtime.restoreRepositoryState({
        workspaceId: "workspace-1",
        importId: "import-1",
        worktreeId: "worktree-1",
        baseCommitSha: "a".repeat(40),
        files: [
          {
            path: "notes/context.bin",
            kind: "untracked",
            contents,
            sha256: "b".repeat(64),
            mode: "100755",
          },
        ],
      }),
    ).resolves.toEqual({
      restored: false,
      conflictPaths: ["src/app.ts"],
    });
    expect(mocks.restoreSandboxSession).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      operationId: "worktree-1",
      worktreeId: "worktree-1",
      baseCommitSha: "a".repeat(40),
      files: [
        {
          path: "notes/context.bin",
          kind: "untracked",
          contents,
          sha256: "b".repeat(64),
          mode: "100755",
        },
      ],
    });
  });

  it("checks commit availability without mutating the sandbox", async () => {
    mocks.executeInSandbox.mockResolvedValue({ output: "", exitCode: 1 });
    const runtime = new SandboxSessionRepositoryRuntime({} as never);
    const sha = "c".repeat(40);

    await expect(runtime.hasCommit("workspace-1", sha)).resolves.toBe(false);
    expect(mocks.executeInSandbox).toHaveBeenCalledWith("workspace-1", {
      command: ["git", "cat-file", "-e", `${sha}^{commit}`],
      timeoutSeconds: 30,
    });
  });

  it("reserves the database worktree ID before materializing that exact sandbox worktree", async () => {
    const selectLimit = vi.fn().mockResolvedValue([{ worktreeId: null }]);
    const selectQuery = {
      from: vi.fn(),
      where: vi.fn(),
      limit: selectLimit,
    };
    selectQuery.from.mockReturnValue(selectQuery);
    selectQuery.where.mockReturnValue(selectQuery);
    const insertReturning = vi
      .fn()
      .mockResolvedValue([
        { id: "reserved-worktree", headSha: "a".repeat(40) },
      ]);
    const insertQuery = {
      values: vi.fn(() => ({ returning: insertReturning })),
    };
    const updateReturning = vi.fn().mockResolvedValue([{ id: "import-1" }]);
    const updateQuery = {
      set: vi.fn(),
      where: vi.fn(() => ({ returning: updateReturning })),
    };
    updateQuery.set.mockReturnValue(updateQuery);
    const transaction = {
      select: vi.fn(() => selectQuery),
      insert: vi.fn(() => insertQuery),
      update: vi.fn(() => updateQuery),
    };
    const database = {
      transaction: vi.fn(
        async (callback: (value: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    mocks.createSandboxWorktree.mockResolvedValue(undefined);
    const runtime = new SandboxSessionRepositoryRuntime(database as never);

    await expect(
      runtime.createIsolatedWorktree({
        workspaceId: "workspace-1",
        importId: "import-1",
        baseCommitSha: "a".repeat(40),
      }),
    ).resolves.toEqual({ worktreeId: "reserved-worktree" });
    expect(insertReturning).toHaveBeenCalledBefore(mocks.createSandboxWorktree);
    expect(updateReturning).toHaveBeenCalledBefore(mocks.createSandboxWorktree);
    expect(mocks.createSandboxWorktree).toHaveBeenCalledWith(
      "workspace-1",
      "reserved-worktree",
      "a".repeat(40),
    );
  });

  it("allocates a new worktree after a discarded conflict", async () => {
    const query = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.limit
      .mockResolvedValueOnce([{ worktreeId: "old-worktree" }])
      .mockResolvedValueOnce([
        { id: "old-worktree", headSha: "a".repeat(40), status: "discarded" },
      ]);
    const insert = {
      values: vi.fn(() => ({
        returning: vi
          .fn()
          .mockResolvedValue([{ id: "new-worktree", headSha: "a".repeat(40) }]),
      })),
    };
    const update = {
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: "import-1" }]),
        })),
      })),
    };
    const transaction = {
      select: vi.fn(() => query),
      insert: vi.fn(() => insert),
      update: vi.fn(() => update),
    };
    const database = {
      transaction: vi.fn(async (fn: (tx: typeof transaction) => unknown) =>
        fn(transaction),
      ),
    };
    mocks.createSandboxWorktree.mockResolvedValue(undefined);
    const runtime = new SandboxSessionRepositoryRuntime(database as never);

    await expect(
      runtime.createIsolatedWorktree({
        workspaceId: "workspace-1",
        importId: "import-1",
        baseCommitSha: "a".repeat(40),
      }),
    ).resolves.toEqual({ worktreeId: "new-worktree" });
    expect(mocks.createSandboxWorktree).toHaveBeenCalledWith(
      "workspace-1",
      "new-worktree",
      "a".repeat(40),
    );
  });
});
