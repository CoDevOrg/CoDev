import { describe, expect, it } from "vitest";

import {
  NEW_BRANCH,
  worktreeFolderName,
  worktreeFormProblem,
} from "./workspace-worktree-checks";

const worktrees = [
  { worktreeId: "main", branch: "HEAD" },
  { worktreeId: "yousefs", branch: "main" },
];

describe("worktree form checks", () => {
  it("turns a typed name into a folder name", () => {
    expect(worktreeFolderName("  Login Fix! ")).toBe("login-fix");
    expect(worktreeFolderName("---")).toBe("");
  });

  it("refuses a branch already open in another worktree", () => {
    expect(
      worktreeFormProblem(
        { choice: NEW_BRANCH, target: "main", folder: "" },
        worktrees,
      ),
    ).toBe(
      "main is already open in main (yousefs). A branch can be open in one worktree at a time.",
    );
  });

  it("refuses an invalid branch name and a taken folder", () => {
    expect(
      worktreeFormProblem(
        { choice: NEW_BRANCH, target: "bad..name", folder: "" },
        worktrees,
      ),
    ).toMatch(/valid Git branch name/);
    expect(
      worktreeFormProblem(
        { choice: NEW_BRANCH, target: "feature/x", folder: "yousefs" },
        worktrees,
      ),
    ).toBe("A worktree folder named yousefs already exists.");
    expect(
      worktreeFormProblem(
        { choice: NEW_BRANCH, target: "feature/x", folder: "" },
        worktrees,
      ),
    ).toBe("");
  });
});
