export type ReviewDiffFile = {
  path: string;
  additions: number;
  deletions: number;
  hunk: string;
};

/**
 * Split a unified `git diff` into per-file summaries for the review panel.
 */
export function parseReviewDiff(diff: string): ReviewDiffFile[] {
  const trimmed = diff.trim();
  if (!trimmed) return [];

  const chunks = trimmed.split(/(?=^diff --git )/m).filter((chunk) => chunk.trim());
  const files: ReviewDiffFile[] = [];

  for (const chunk of chunks) {
    const header = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const path =
      header?.[2]?.trim() ||
      header?.[1]?.trim() ||
      chunk.match(/^\+\+\+ b\/(.+)$/m)?.[1]?.trim() ||
      "unknown";

    let additions = 0;
    let deletions = 0;
    for (const line of chunk.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
      if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
    }

    files.push({
      path,
      additions,
      deletions,
      hunk: chunk.trimEnd(),
    });
  }

  return files;
}
