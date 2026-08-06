import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDatabaseMock,
  getRepositoryMock,
  checkpointMock,
  rebaseMock,
  executeMock,
  publishMock,
} = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
  getRepositoryMock: vi.fn(),
  checkpointMock: vi.fn(),
  rebaseMock: vi.fn(),
  executeMock: vi.fn(),
  publishMock: vi.fn(),
}));

vi.mock("./database", () => ({
  getDatabase: () => getDatabaseMock(),
}));

vi.mock("./github", () => ({
  getRepository: getRepositoryMock,
}));

vi.mock("./orchestrator", () => ({
  checkpointSandboxWorktree: checkpointMock,
  rebaseSandboxWorktree: rebaseMock,
  executeInSandbox: executeMock,
}));

vi.mock("./github-publication", () => ({
  PublicationError: class PublicationError extends Error {
    status: number;
    constructor(message: string, status = 409) {
      super(message);
      this.status = status;
    }
  },
  publishAgentWorktreeBranch: publishMock,
}));

vi.mock("./access", () => ({
  requireWorkspacePermission: vi.fn().mockResolvedValue({}),
}));

import {
  publishAgentWorktreeToGitHub,
  syncAgentWorktreeWithGitHub,
} from "./agent-github";

function chain(result: unknown) {
  const query = {
    select: vi.fn(),
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockResolvedValue(result),
    update: vi.fn(),
    set: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.update.mockReturnValue(query);
  query.set.mockReturnValue(query);
  query.where.mockImplementation(() => ({
    limit: query.limit,
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(undefined).then(resolve, reject),
  }));
  return query;
}

describe("agent GitHub tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({
      output: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
      exitCode: 0,
    });
    checkpointMock.mockResolvedValue({
      headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
  });

  it("rebases onto integration when GitHub tip matches", async () => {
    const tip = "cccccccccccccccccccccccccccccccccccccccc";
    const agentQuery = chain([
      {
        worktreeId: "wt-1",
        headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        worktreeStatus: "active",
        repository: "acme/app",
        installationId: 1,
        repositoryId: 2,
        baseSha: tip,
        defaultBranch: "main",
      },
    ]);
    const integrationQuery = chain([{ headSha: tip }]);
    getDatabaseMock
      .mockReturnValueOnce(agentQuery)
      .mockReturnValueOnce(integrationQuery)
      .mockReturnValue(chain([]));
    getRepositoryMock.mockResolvedValue({
      repository: { default_branch: "main", full_name: "acme/app", id: 2 },
      baseSha: tip,
    });
    rebaseMock.mockResolvedValue({ headSha: tip });

    const result = await syncAgentWorktreeWithGitHub({
      workspaceId: "ws-1",
      worktreeId: "wt-1",
      userId: "user-1",
    });

    expect(result.synced).toBe(true);
    expect(rebaseMock).toHaveBeenCalledWith("ws-1", "wt-1", {
      expectedHeadSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ontoSha: tip,
    });
  });

  it("asks for workspace sync when integration is behind GitHub", async () => {
    const agentQuery = chain([
      {
        worktreeId: "wt-1",
        headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        worktreeStatus: "active",
        repository: "acme/app",
        installationId: 1,
        repositoryId: 2,
        baseSha: "dddddddddddddddddddddddddddddddddddddddd",
        defaultBranch: "main",
      },
    ]);
    const integrationQuery = chain([
      { headSha: "dddddddddddddddddddddddddddddddddddddddd" },
    ]);
    getDatabaseMock
      .mockReturnValueOnce(agentQuery)
      .mockReturnValueOnce(integrationQuery)
      .mockReturnValue(chain([]));
    getRepositoryMock.mockResolvedValue({
      repository: { default_branch: "main", full_name: "acme/app", id: 2 },
      baseSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    });

    const result = await syncAgentWorktreeWithGitHub({
      workspaceId: "ws-1",
      worktreeId: "wt-1",
      userId: "user-1",
    });

    expect(result.synced).toBe(false);
    expect(result.message).toMatch(/Stop the sandbox/);
    expect(rebaseMock).not.toHaveBeenCalled();
  });

  it("publishes through the control-plane helper", async () => {
    const tip = "ffffffffffffffffffffffffffffffffffffffff";
    const agentQuery = chain([
      {
        worktreeId: "wt-1",
        headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        worktreeStatus: "active",
        repository: "acme/app",
        installationId: 1,
        repositoryId: 2,
        baseSha: tip,
        defaultBranch: "main",
      },
    ]);
    const integrationQuery = chain([{ headSha: tip }]);
    getDatabaseMock
      .mockReturnValueOnce(agentQuery)
      .mockReturnValueOnce(integrationQuery)
      .mockReturnValue(chain([]));
    publishMock.mockResolvedValue({
      branchName: "codev/agent-demo",
      commitSha: tip,
      htmlUrl: "https://github.com/acme/app/tree/codev/agent-demo",
      sourceHeadSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    const result = await publishAgentWorktreeToGitHub({
      workspaceId: "ws-1",
      worktreeId: "wt-1",
      userId: "user-1",
      branchName: "codev/agent-demo",
    });

    expect(result.branchName).toBe("codev/agent-demo");
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        worktreeId: "wt-1",
        branchName: "codev/agent-demo",
        expectedHeadSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    );
  });
});
