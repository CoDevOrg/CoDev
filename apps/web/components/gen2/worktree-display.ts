import type { Gen2SupersetWorktree } from "@codev/contracts";

const PRIMARY_WORKTREE_ID = "main";
/** Git's name for a checkout that is not on a branch. */
export const DETACHED_BRANCH = "HEAD";

/**
 * Guest images before the detached-worktree fix list only checkouts that are
 * on a branch, and the primary checkout is cloned at a commit, so it would
 * vanish from the switcher. It always exists; keep it listed.
 */
export function withPrimaryWorktree(worktrees: Gen2SupersetWorktree[]) {
  if (worktrees.some((worktree) => worktree.worktreeId === PRIMARY_WORKTREE_ID))
    return worktrees;
  return [
    { worktreeId: PRIMARY_WORKTREE_ID, branch: DETACHED_BRANCH },
    ...worktrees,
  ];
}

/** Whether the name is what `worktreeIdForBranch` derives from the branch. */
function namedAfter(branch: string, worktreeId: string) {
  const derived = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 56)
    .replace(/^-+|-+$/g, "");
  return (
    worktreeId === derived ||
    worktreeId.replace(/-\d+$/, "") === derived ||
    branch.endsWith(`/${worktreeId}`)
  );
}

/**
 * How a worktree reads: its branch, plus its name when the branch alone
 * would not say which worktree it is (a detached primary, or a worktree whose
 * name is not just its branch, such as `yousefs` on `main`).
 */
export function worktreeDisplay(worktree: Gen2SupersetWorktree) {
  const { worktreeId, branch } = worktree;
  const label = branch === DETACHED_BRANCH ? "detached HEAD" : branch;
  const named =
    worktreeId === PRIMARY_WORKTREE_ID
      ? branch !== PRIMARY_WORKTREE_ID
      : !namedAfter(branch, worktreeId);
  const detail = !named
    ? null
    : worktreeId === PRIMARY_WORKTREE_ID
      ? "primary"
      : worktreeId;
  return { label, detail, text: detail ? `${label} (${detail})` : label };
}
