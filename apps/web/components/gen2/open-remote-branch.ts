import type { Gen2SupersetWorktree } from "@codev/contracts";

import { createSupersetWorktree } from "./superset-file-client";

const MAX_ID_BASE = 56;

/** A valid, unused worktree id for a branch: `feature/Auth` → `feature-auth`. */
export function worktreeIdForBranch(branch: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const base =
    branch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, MAX_ID_BASE)
      .replace(/^-+|-+$/g, "") || "branch";
  if (base !== "main" && !used.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const id = `${base}-${suffix}`;
    if (!used.has(id)) return id;
  }
}

/**
 * Opens a remote branch in a worktree of its own, tracking `origin/<branch>`.
 * A branch that already exists on the machine is checked out as it is. The
 * machine only knows the remote branches it has fetched, so a newer branch
 * asks for a fetch rather than silently branching from the wrong commit.
 */
export async function openRemoteBranch(
  workspaceId: string,
  branch: string,
  worktrees: Gen2SupersetWorktree[],
  /** A folder name the member chose; derived from the branch otherwise. */
  name?: string | undefined,
): Promise<Gen2SupersetWorktree> {
  const worktreeId =
    name ||
    worktreeIdForBranch(
      branch,
      worktrees.map((worktree) => worktree.worktreeId),
    );
  try {
    return await createSupersetWorktree(workspaceId, {
      worktreeId,
      branch,
      baseRef: `origin/${branch}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("baseRef can only be supplied")) {
      return createSupersetWorktree(workspaceId, { worktreeId, branch });
    }
    if (
      /invalid reference|not a valid object name|unknown revision/i.test(
        message,
      )
    ) {
      throw new Error(
        `${branch} isn’t on the workspace machine yet. Run “git fetch origin” in the terminal, then open it again.`,
      );
    }
    throw error;
  }
}
