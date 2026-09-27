import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
}));

vi.mock("./workspaces", () => ({
  requireGen2Member: (...args: unknown[]) => mocks.member(...args),
}));

vi.mock("../runtime/orchestrator-superset-runtime", () => ({
  listSupersetWorktrees: (...args: unknown[]) => mocks.list(...args),
  createSupersetWorktree: (...args: unknown[]) => mocks.create(...args),
}));

vi.mock("../runtime/orchestrator-request", () => ({
  OrchestratorError: class OrchestratorError extends Error {},
  orchestratorRequest: vi.fn(),
}));

const { createGen2SupersetWorktree, listGen2SupersetWorktrees } =
  await import("./superset");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const originalSupersetRuntime = process.env.CODEV_SUPERSET_RUNTIME_ENABLED;

describe("Gen 2 Superset worktrees", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CODEV_SUPERSET_RUNTIME_ENABLED = "true";
    mocks.member.mockResolvedValue({ status: "ready", role: "owner" });
  });

  it("does not expose runtime worktrees while the migration flag is off", async () => {
    delete process.env.CODEV_SUPERSET_RUNTIME_ENABLED;
    await expect(
      listGen2SupersetWorktrees(workspaceId, userId),
    ).rejects.toThrow(/not enabled/);
    expect(mocks.member).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("checks membership before calling the private host bridge", async () => {
    mocks.member.mockRejectedValue(new Error("not a member"));
    await expect(
      listGen2SupersetWorktrees(workspaceId, userId),
    ).rejects.toThrow("not a member");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("does not let a viewer create an isolated checkout", async () => {
    mocks.member.mockResolvedValue({ status: "ready", role: "viewer" });
    await expect(
      createGen2SupersetWorktree(workspaceId, userId, {
        worktreeId: "agent-a",
        branch: "codev/agent-a",
      }),
    ).rejects.toThrow(/Edit permission/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates and returns a host-owned worktree for an editor", async () => {
    mocks.create.mockResolvedValue({
      worktreeId: "agent-a",
      branch: "codev/agent-a",
    });
    await expect(
      createGen2SupersetWorktree(workspaceId, userId, {
        worktreeId: "agent-a",
        branch: "codev/agent-a",
        baseRef: "HEAD",
      }),
    ).resolves.toEqual({ worktreeId: "agent-a", branch: "codev/agent-a" });
    expect(mocks.create).toHaveBeenCalledWith(workspaceId, {
      worktreeId: "agent-a",
      branch: "codev/agent-a",
      baseRef: "HEAD",
    });
  });
});

afterEach(() => {
  if (originalSupersetRuntime === undefined) {
    delete process.env.CODEV_SUPERSET_RUNTIME_ENABLED;
  } else {
    process.env.CODEV_SUPERSET_RUNTIME_ENABLED = originalSupersetRuntime;
  }
});
