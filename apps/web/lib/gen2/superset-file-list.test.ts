import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  request: vi.fn(),
  tree: vi.fn(),
  baseSha: vi.fn(),
}));

vi.mock("./workspaces", () => ({
  requireGen2Member: (...args: unknown[]) => mocks.member(...args),
}));

vi.mock("../github/repository-tree", () => ({
  listRepositoryTree: (...args: unknown[]) => mocks.tree(...args),
}));

vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mocks.baseSha(),
        }),
      }),
    }),
  }),
}));

vi.mock("../runtime/orchestrator-request", () => ({
  OrchestratorError: class OrchestratorError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  },
  orchestratorRequest: (...args: unknown[]) => mocks.request(...args),
}));

const { listGen2SupersetFiles } = await import("./superset");
const { OrchestratorError } = await import("../runtime/orchestrator-request");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function member(fullName?: string) {
  return {
    status: "ready",
    role: "owner",
    repository: fullName
      ? { fullName, private: false, defaultBranch: "main" }
      : null,
  };
}

describe("listGen2SupersetFiles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.member.mockResolvedValue(member("CoDevOrg/CoDev"));
    mocks.baseSha.mockResolvedValue([{ baseSha: "a".repeat(40) }]);
  });
  afterEach(() => vi.resetAllMocks());

  it("lists a large repository from GitHub and leaves the guest alone", async () => {
    mocks.tree.mockResolvedValue(
      Array.from({ length: 5_001 }, (_, index) => ({
        path: `file-${index}.txt`,
        type: "blob" as const,
        size: 1,
      })),
    );

    const files = await listGen2SupersetFiles(workspaceId, userId, "main");

    expect(files).toHaveLength(5_001);
    expect(files[0]).toEqual({ path: "file-0.txt", kind: "file", size: 1 });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("keeps the guest list for a repository the guest can walk", async () => {
    mocks.tree.mockResolvedValue([
      { path: "README.md", type: "blob", size: 8 },
    ]);
    mocks.request.mockResolvedValue({
      json: async () => ({
        files: [{ path: "README.md", kind: "file", size: 8 }],
      }),
    });

    const files = await listGen2SupersetFiles(workspaceId, userId, "main");

    expect(files).toEqual([{ path: "README.md", kind: "file", size: 8 }]);
    expect(mocks.request).toHaveBeenCalled();
  });

  it("uses the repository list when the guest refuses a large checkout", async () => {
    mocks.tree.mockResolvedValue([
      { path: "README.md", type: "blob", size: 8 },
    ]);
    mocks.request.mockRejectedValue(
      new OrchestratorError(
        "Workspace contains too many files to display.",
        400,
      ),
    );

    const files = await listGen2SupersetFiles(workspaceId, userId, "main");

    expect(files).toEqual([{ path: "README.md", kind: "file", size: 8 }]);
  });

  it("still asks the guest for another branch", async () => {
    mocks.request.mockResolvedValue({
      json: async () => ({ files: [] }),
    });

    await listGen2SupersetFiles(workspaceId, userId, "agent-1");

    expect(mocks.tree).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalled();
  });
});
