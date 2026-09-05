import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendWorkspaceEvent: vi.fn(),
  deleteSandboxWorktree: vi.fn(),
  getDatabase: vi.fn(),
  getWorkspaceForMember: vi.fn(),
  mergeSandboxWorktree: vi.fn(),
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
  checkpointSandboxWorktree: vi.fn(),
  deleteSandboxWorktree: mocks.deleteSandboxWorktree,
  mergeSandboxWorktree: mocks.mergeSandboxWorktree,
  rebaseSandboxWorktree: vi.fn(),
  reviewSandboxWorktree: vi.fn(),
}));
vi.mock("./workspaces", () => ({
  getWorkspaceForMember: mocks.getWorkspaceForMember,
}));
vi.mock("workflow/api", () => ({ getRun: vi.fn() }));

import { discardAgentWorktree, mergeAgentReview } from "./agent-review";

describe("mergeAgentReview", () => {
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
          worktreeStatus: "frozen",
          worktreeHeadSha: "agent-r2",
          reviewHeadSha: "agent-r2",
          reviewBaseSha: "main-r1",
          reviewDiffDigest: "sha256:review-digest",
        },
      ])
      .mockResolvedValueOnce([{ id: "integration-1", headSha: "main-r1" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const updateQuery = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateQuery.set.mockReturnValue(updateQuery);
    const transaction = { update: vi.fn(() => updateQuery) };
    const database = {
      select: vi.fn(() => query),
      transaction: vi.fn(async (callback) => callback(transaction)),
    };

    mocks.getDatabase.mockReturnValue(database);
    mocks.getWorkspaceForMember.mockResolvedValue({ id: "workspace-1" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.mergeSandboxWorktree.mockResolvedValue({ headSha: "merge-r3" });
    mocks.deleteSandboxWorktree.mockResolvedValue(undefined);
    mocks.appendWorkspaceEvent.mockResolvedValue({ id: "event-1" });
  });

  it("rejects a stale checkpoint before any merge action starts", async () => {
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
          worktreeStatus: "frozen",
          worktreeHeadSha: "agent-r2",
          reviewHeadSha: "agent-r2",
          reviewBaseSha: "main-r1",
          reviewDiffDigest: "sha256:review-digest",
        },
      ])
      .mockResolvedValueOnce([{ id: "integration-1", headSha: "main-r2" }])
      .mockResolvedValueOnce([]);
    const updateQuery = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateQuery.set.mockReturnValue(updateQuery);
    mocks.getDatabase.mockReturnValue({
      select: vi.fn(() => query),
      update: vi.fn(() => updateQuery),
    });

    await expect(
      mergeAgentReview("workspace-1", "session-1", "user-1"),
    ).rejects.toMatchObject({
      message: "The integration worktree advanced. Rebase and review again.",
      status: 409,
    });
    expect(mocks.mergeSandboxWorktree).not.toHaveBeenCalled();
    expect(mocks.appendWorkspaceEvent).not.toHaveBeenCalled();
  });

  it("records the approving actor and reviewed revisions after one merge", async () => {
    await expect(
      mergeAgentReview("workspace-1", "session-1", "user-1"),
    ).resolves.toEqual({ headSha: "merge-r3" });

    expect(mocks.appendWorkspaceEvent).toHaveBeenCalledTimes(1);
    expect(mocks.appendWorkspaceEvent).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      actorId: "user-1",
      type: "agent.review_merged",
      payload: {
        sessionId: "session-1",
        worktreeId: "worktree-1",
        integrationWorktreeId: "integration-1",
        reviewBaseSha: "main-r1",
        reviewHeadSha: "agent-r2",
        mergedHeadSha: "merge-r3",
        reviewDiffDigest: "sha256:review-digest",
      },
    });
  });
});

describe("discardAgentWorktree", () => {
  let query: {
    from: ReturnType<typeof vi.fn>;
    innerJoin: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    query = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      limit: vi.fn(),
      where: vi.fn(),
    };
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.where.mockReturnValue(query);
    const updateQuery = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateQuery.set.mockReturnValue(updateQuery);
    const transaction = { update: vi.fn(() => updateQuery) };
    const database = {
      select: vi.fn(() => query),
      transaction: vi.fn(
        async (callback: (value: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };

    mocks.getDatabase.mockReturnValue(database);
    mocks.getWorkspaceForMember.mockResolvedValue({ id: "workspace-1" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.deleteSandboxWorktree.mockResolvedValue(undefined);
    mocks.appendWorkspaceEvent.mockResolvedValue({ id: "event-1" });
  });

  it("removes the worktree, releases claims, audits once, and is idempotent", async () => {
    query.limit
      .mockResolvedValueOnce([
        {
          sessionId: "session-1",
          workflowRunId: null,
          worktreeId: "worktree-1",
          worktreeStatus: "frozen",
          worktreeHeadSha: "agent-r2",
          reviewHeadSha: "agent-r2",
          reviewBaseSha: "main-r1",
          reviewDiffDigest: "sha256:review-digest",
        },
      ])
      .mockResolvedValueOnce([{ id: "integration-1", headSha: "main-r1" }])
      // No sibling session is live on this worktree, so the checkout goes.
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          sessionId: "session-1",
          workflowRunId: null,
          worktreeId: "worktree-1",
          worktreeStatus: "discarded",
          worktreeHeadSha: "agent-r2",
          reviewHeadSha: "agent-r2",
          reviewBaseSha: "main-r1",
          reviewDiffDigest: "sha256:review-digest",
        },
      ])
      .mockResolvedValueOnce([{ id: "integration-1", headSha: "main-r1" }]);

    await expect(
      discardAgentWorktree("workspace-1", "session-1", "user-1"),
    ).resolves.toEqual({ status: "discarded" });
    await expect(
      discardAgentWorktree("workspace-1", "session-1", "user-1"),
    ).resolves.toEqual({ status: "discarded" });

    expect(mocks.deleteSandboxWorktree).toHaveBeenCalledTimes(1);
    expect(mocks.appendWorkspaceEvent).toHaveBeenCalledTimes(1);
    expect(mocks.appendWorkspaceEvent).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      actorId: "user-1",
      type: "agent.review_discarded",
      payload: {
        sessionId: "session-1",
        worktreeId: "worktree-1",
        reviewBaseSha: "main-r1",
        reviewHeadSha: "agent-r2",
        reviewDiffDigest: "sha256:review-digest",
        sandboxWorktreeRemoved: true,
        claimsReleased: true,
      },
    });
  });

  it("ends only this agent when a sibling session shares the worktree", async () => {
    query.limit
      .mockResolvedValueOnce([
        {
          sessionId: "session-1",
          workflowRunId: null,
          worktreeId: "worktree-1",
          worktreeStatus: "active",
          worktreeHeadSha: "agent-r2",
          reviewHeadSha: null,
          reviewBaseSha: null,
          reviewDiffDigest: null,
        },
      ])
      .mockResolvedValueOnce([{ id: "integration-1", headSha: "main-r1" }])
      .mockResolvedValueOnce([{ id: "session-2" }]);

    await expect(
      discardAgentWorktree("workspace-1", "session-1", "user-1"),
    ).resolves.toEqual({ status: "stopped" });

    // The sibling is still working in this checkout, so it must survive.
    expect(mocks.deleteSandboxWorktree).not.toHaveBeenCalled();
    expect(mocks.appendWorkspaceEvent).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      actorId: "user-1",
      type: "agent.session_stopped",
      payload: {
        sessionId: "session-1",
        worktreeId: "worktree-1",
        sandboxWorktreeRemoved: false,
        claimsReleased: true,
      },
    });
  });
});
