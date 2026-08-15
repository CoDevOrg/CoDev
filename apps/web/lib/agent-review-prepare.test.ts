import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkpointSandboxWorktree: vi.fn(),
  createSandboxWorktree: vi.fn(),
  executeInSandbox: vi.fn(),
  getDatabase: vi.fn(),
  getWorkspaceForMember: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  reviewSandboxWorktree: vi.fn(),
}));

vi.mock("./audit", () => ({ appendWorkspaceEvent: vi.fn() }));
vi.mock("./access", () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
}));
vi.mock("./database", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("./orchestrator", () => ({
  OrchestratorError: class OrchestratorError extends Error {
    status: number;
    conflictPaths: string[];
    constructor(message: string, status: number, conflictPaths: string[] = []) {
      super(message);
      this.status = status;
      this.conflictPaths = conflictPaths;
    }
  },
  checkpointSandboxWorktree: mocks.checkpointSandboxWorktree,
  createSandboxWorktree: mocks.createSandboxWorktree,
  deleteSandboxWorktree: vi.fn(),
  executeInSandbox: mocks.executeInSandbox,
  mergeSandboxWorktree: vi.fn(),
  rebaseSandboxWorktree: vi.fn(),
  reviewSandboxWorktree: mocks.reviewSandboxWorktree,
}));
vi.mock("./workspaces", () => ({
  getWorkspaceForMember: mocks.getWorkspaceForMember,
}));
vi.mock("workflow/api", () => ({ getRun: vi.fn() }));

import { prepareAgentReview } from "./agent-review";
import { OrchestratorError } from "./orchestrator";

const headSha = "a".repeat(40);
const integrationSha = "b".repeat(40);

describe("prepareAgentReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const query = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      limit: vi.fn(),
      select: vi.fn(),
      where: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.limit
      .mockResolvedValueOnce([
        {
          sessionId: "session-1",
          workflowRunId: null,
          worktreeId: "worktree-1",
          worktreeStatus: "active",
          worktreeHeadSha: "",
          reviewHeadSha: null,
          reviewBaseSha: null,
          reviewDiffDigest: null,
        },
      ])
      .mockResolvedValueOnce([{ id: "integration-1", headSha: integrationSha }])
      .mockResolvedValueOnce([]);

    const updateQuery = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateQuery.set.mockReturnValue(updateQuery);
    const transaction = { update: vi.fn(() => updateQuery) };
    mocks.getDatabase.mockReturnValue({
      select: vi.fn(() => query),
      update: vi.fn(() => updateQuery),
      transaction: vi.fn(
        async (callback: (value: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    });
    mocks.getWorkspaceForMember.mockResolvedValue({ id: "workspace-1" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.createSandboxWorktree.mockResolvedValue(undefined);
    mocks.checkpointSandboxWorktree
      .mockRejectedValueOnce(new OrchestratorError("worktree not found", 400))
      .mockResolvedValueOnce({ headSha });
    mocks.reviewSandboxWorktree.mockResolvedValue({
      baseSha: integrationSha,
      headSha,
      diff: "diff --git a/oi10-review.txt b/oi10-review.txt\n",
      diffDigest: "c".repeat(64),
    });
  });

  it("creates a missing sandbox worktree before freezing the checkpoint", async () => {
    await expect(
      prepareAgentReview("workspace-1", "session-1", "user-1"),
    ).resolves.toMatchObject({
      headSha,
      baseSha: integrationSha,
    });
    expect(mocks.createSandboxWorktree).toHaveBeenCalledWith(
      "workspace-1",
      "worktree-1",
      integrationSha,
    );
    expect(mocks.checkpointSandboxWorktree).toHaveBeenCalledTimes(2);
  });

  it("freezes the checkpoint through exec when the review API is forbidden", async () => {
    mocks.checkpointSandboxWorktree.mockReset();
    mocks.checkpointSandboxWorktree.mockRejectedValue(
      new OrchestratorError("Sandbox service returned HTTP 403.", 403),
    );
    mocks.reviewSandboxWorktree.mockRejectedValue(
      new OrchestratorError("Sandbox service returned HTTP 403.", 403),
    );
    mocks.executeInSandbox
      .mockResolvedValueOnce({ output: "", exitCode: 0 })
      .mockResolvedValueOnce({ output: "", exitCode: 1 })
      .mockResolvedValueOnce({ output: "", exitCode: 0 })
      .mockResolvedValueOnce({ output: `${headSha}\n`, exitCode: 0 })
      .mockResolvedValueOnce({
        output: "diff --git a/oi10-review.txt b/oi10-review.txt\n",
        exitCode: 0,
      });

    await expect(
      prepareAgentReview("workspace-1", "session-1", "user-1"),
    ).resolves.toMatchObject({
      headSha,
      baseSha: integrationSha,
    });
    expect(mocks.executeInSandbox).toHaveBeenCalled();
  });
});
