import {
  gen2BranchNameSchema,
  type Gen2SupersetWorktree,
} from "@codev/contracts";

import { DEFAULT_SUPERSET_WORKTREE_ID } from "./superset-file-client";
import { worktreeDisplay } from "./worktree-display";

/** The branch choice that means "create a new branch". */
export const NEW_BRANCH = "__new__";

/** A folder name from what the member typed: lowercase words and hyphens. */
export function worktreeFolderName(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** What is wrong with the chosen branch or folder, if anything. */
export function worktreeFormProblem(
  input: { choice: string; target: string; folder: string },
  worktrees: Gen2SupersetWorktree[],
) {
  const open = worktrees.find((worktree) => worktree.branch === input.target);
  if (open)
    return `${input.target} is already open in ${worktreeDisplay(open).text}. A branch can be open in one worktree at a time.`;
  if (
    input.choice === NEW_BRANCH &&
    input.target &&
    !gen2BranchNameSchema.safeParse(input.target).success
  )
    return "Use a valid Git branch name, such as feature/login.";
  if (
    input.folder === DEFAULT_SUPERSET_WORKTREE_ID ||
    worktrees.some((worktree) => worktree.worktreeId === input.folder)
  )
    return `A worktree folder named ${input.folder} already exists.`;
  return "";
}
