import type { Gen2SupersetEntry } from "@codev/contracts";

function rank(path: string, query: string) {
  const lower = path.toLowerCase();
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  if (base.startsWith(query)) return 0;
  if (lower.startsWith(query)) return 1;
  if (base.includes(query)) return 2;
  return lower.includes(query) ? 3 : -1;
}

/**
 * The entries whose path matches what the member typed, best first: a file
 * name that starts with it, then a path that does, then any substring.
 * Filtering runs on the cached list, so typing never queries the guest.
 */
export function matchComposerFiles(
  entries: Gen2SupersetEntry[],
  query: string,
  limit: number,
) {
  const needle = query.trim().toLowerCase();
  return entries
    .map((entry) => ({ entry, score: rank(entry.path, needle) }))
    .filter(({ score }) => score >= 0)
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.entry.path.length - right.entry.path.length ||
        left.entry.path.localeCompare(right.entry.path),
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}
