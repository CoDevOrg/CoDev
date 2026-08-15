import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeInSandbox: vi.fn(),
  getDatabase: vi.fn(),
  getWorkspaceAccess: vi.fn(),
  listAgentSessions: vi.fn(),
  listWorkspaceEvents: vi.fn(),
  reviewSandboxWorktree: vi.fn(),
}));

vi.mock("./access", () => ({
  getWorkspaceAccess: mocks.getWorkspaceAccess,
}));
vi.mock("./agent-runtime", () => ({
  listAgentSessions: mocks.listAgentSessions,
}));
vi.mock("./audit", () => ({
  listWorkspaceEvents: mocks.listWorkspaceEvents,
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
  executeInSandbox: mocks.executeInSandbox,
  reviewSandboxWorktree: mocks.reviewSandboxWorktree,
}));

import { OrchestratorError } from "./orchestrator";
import { loadReviewSnapshot } from "./review-checkpoint-server";

const workspaceId = "bed7a975-eccf-4742-85c6-cab41ce02830";
const user = { id: "user-1", name: "CoDev Test Jordan" };
const session = {
  id: "session-1",
  name: "OI.11 review",
  provider: "codex",
  status: "idle",
  worktreeId: "worktree-1",
  worktreeName: "Managed proposal",
  worktreeStatus: "frozen",
  ownerName: "CoDev Test Jordan",
  ownerLogin: "jordan",
  issueTitle: "OI.11 review",
  createdAt: new Date("2026-08-15T10:00:00Z"),
  reviewBaseSha: "b".repeat(40),
  reviewHeadSha: "a".repeat(40),
  reviewDiffDigest: "c".repeat(64),
  turns: [],
};

describe("loadReviewSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const query = {
      from: vi.fn(),
      limit: vi.fn(),
      select: vi.fn(),
      where: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.limit.mockResolvedValue([{ headSha: "b".repeat(40) }]);
    mocks.getDatabase.mockReturnValue({ select: vi.fn(() => query) });
    mocks.getWorkspaceAccess.mockResolvedValue({
      role: "owner",
      permissions: { review: true, merge: true },
    });
    mocks.listAgentSessions.mockResolvedValue([session]);
    mocks.listWorkspaceEvents.mockResolvedValue([]);
  });

  it("keeps a prepared checkpoint when sandbox exec cannot load the frozen diff", async () => {
    mocks.reviewSandboxWorktree.mockRejectedValue(
      new OrchestratorError("Sandbox service returned HTTP 403.", 403),
    );
    mocks.executeInSandbox.mockRejectedValue(
      new OrchestratorError("sandbox not found", 404),
    );

    await expect(loadReviewSnapshot(workspaceId, user)).resolves.toMatchObject({
      checkpoints: [
        expect.objectContaining({
          sessionId: session.id,
          worktreeId: session.worktreeId,
          prepared: true,
          stale: false,
          summary: null,
        }),
      ],
      approval: { state: "current", blocked: false, mergeStarted: false },
    });
  });
});
