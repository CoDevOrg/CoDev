import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createWorktree: vi.fn() }));

vi.mock("./superset-file-client", () => ({
  createSupersetWorktree: mocks.createWorktree,
}));

import { openRemoteBranch, worktreeIdForBranch } from "./open-remote-branch";

const main = { worktreeId: "main", branch: "main" };

describe("worktreeIdForBranch", () => {
  it("turns a branch name into a valid worktree id", () => {
    expect(worktreeIdForBranch("feature/Auth_Flow", [])).toBe(
      "feature-auth-flow",
    );
    expect(worktreeIdForBranch("--release/1.2--", [])).toBe("release-1-2");
    expect(worktreeIdForBranch("🚀", [])).toBe("branch");
  });

  it("never reuses an id or the primary worktree's", () => {
    expect(worktreeIdForBranch("main", ["main"])).toBe("main-2");
    expect(worktreeIdForBranch("fix", ["fix", "fix-2"])).toBe("fix-3");
    expect(worktreeIdForBranch("x".repeat(80), []).length).toBeLessThanOrEqual(
      64,
    );
  });
});

describe("openRemoteBranch", () => {
  beforeEach(() => {
    mocks.createWorktree.mockReset();
  });

  it("checks the branch out from origin into its own worktree", async () => {
    mocks.createWorktree.mockResolvedValue({
      worktreeId: "develop",
      branch: "develop",
    });
    await openRemoteBranch("ws-1", "develop", [main]);
    expect(mocks.createWorktree).toHaveBeenCalledWith("ws-1", {
      worktreeId: "develop",
      branch: "develop",
      baseRef: "origin/develop",
    });
  });

  it("checks out a branch that already exists on the machine as it is", async () => {
    mocks.createWorktree
      .mockRejectedValueOnce(
        new Error("baseRef can only be supplied when creating a new branch."),
      )
      .mockResolvedValueOnce({ worktreeId: "develop", branch: "develop" });
    await openRemoteBranch("ws-1", "develop", [main]);
    expect(mocks.createWorktree).toHaveBeenLastCalledWith("ws-1", {
      worktreeId: "develop",
      branch: "develop",
    });
  });

  it("asks for a fetch when the machine has never seen the branch", async () => {
    mocks.createWorktree.mockRejectedValue(
      new Error("fatal: invalid reference: origin/new-thing"),
    );
    await expect(openRemoteBranch("ws-1", "new-thing", [main])).rejects.toThrow(
      /git fetch origin/,
    );
  });
});
