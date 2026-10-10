import type { Gen2SupersetWorktree } from "@codev/contracts";

import { worktreeIdForBranch } from "./open-remote-branch";
import {
  createSupersetWorktree,
  DEFAULT_SUPERSET_WORKTREE_ID,
} from "./superset-file-client";

/**
 * Creates a branch in a worktree of its own, shared by the rail's "New
 * worktree" form and an agent's create_branch proposal. Without an explicit
 * id the worktree is named after the branch. A missing base ref means the
 * primary checkout's HEAD, which is what the guest uses by default.
 */
export async function createWorktreeFrom(
  workspaceId: string,
  input: {
    branch: string;
    worktreeId?: string | undefined;
    baseRef?: string | undefined;
  },
  worktrees: Gen2SupersetWorktree[],
): Promise<Gen2SupersetWorktree> {
  const branch = input.branch.trim();
  const worktreeId =
    input.worktreeId?.trim() ||
    worktreeIdForBranch(
      branch,
      worktrees.map((worktree) => worktree.worktreeId),
    );
  const baseRef = input.baseRef?.trim();
  try {
    return await createSupersetWorktree(workspaceId, {
      worktreeId,
      branch,
      ...(baseRef ? { baseRef } : {}),
    });
  } catch (error) {
    // The branch already exists on the machine: check it out as it is.
    const message = error instanceof Error ? error.message : "";
    if (!baseRef || !message.includes("baseRef can only be supplied"))
      throw error;
    return createSupersetWorktree(workspaceId, { worktreeId, branch });
  }
}

/**
 * Where an agent's new branch starts unless it names a base: the branch the
 * member is on, or the primary checkout's HEAD when they are on main.
 * `label` is what the card shows; `baseRef` is what is sent (none for HEAD).
 */
export function branchBaseFor(
  current: Gen2SupersetWorktree,
  worktrees: Gen2SupersetWorktree[],
  requested?: string | undefined,
): { baseRef: string | undefined; label: string } {
  if (requested) return { baseRef: requested, label: requested };
  if (current.worktreeId !== DEFAULT_SUPERSET_WORKTREE_ID) {
    return { baseRef: current.branch, label: current.branch };
  }
  const main = worktrees.find(
    (worktree) => worktree.worktreeId === DEFAULT_SUPERSET_WORKTREE_ID,
  );
  return { baseRef: undefined, label: main?.branch ?? "HEAD" };
}
