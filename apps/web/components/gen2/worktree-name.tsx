import type { Gen2SupersetWorktree } from "@codev/contracts";

import { worktreeDisplay } from "./worktree-display";

/** A worktree's branch, with its name when the branch alone is ambiguous. */
export function WorktreeName({
  worktree,
  className,
}: {
  worktree: Gen2SupersetWorktree;
  className?: string | undefined;
}) {
  const { label, detail } = worktreeDisplay(worktree);
  return (
    <span className={className}>
      {label}
      {detail ? (
        <span className="gen2-worktree-name-detail"> · {detail}</span>
      ) : null}
    </span>
  );
}
