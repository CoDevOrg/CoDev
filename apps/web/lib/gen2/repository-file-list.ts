import type { Gen2SupersetEntry } from "@codev/contracts";

import type { RepositoryTreeNode } from "../github/repository-tree";

/**
 * The guest file bridge refuses the whole tree once it has walked this many
 * files and folders. Matches `MAX_LISTED_FILES` in the Superset host service.
 */
export const GUEST_FILE_LIST_LIMIT = 5_000;

export const GUEST_FILE_LIST_TOO_LARGE =
  "Workspace contains too many files to display.";

export function repositoryTreeToEntries(
  nodes: RepositoryTreeNode[],
): Gen2SupersetEntry[] {
  const entries: Gen2SupersetEntry[] = [];
  for (const node of nodes) {
    if (!node.path || node.path.split("/").includes(".git")) continue;
    if (node.type === "tree") {
      entries.push({ path: node.path, kind: "directory" });
      continue;
    }
    if (node.type !== "blob") continue;
    entries.push({ path: node.path, kind: "file", size: node.size ?? 0 });
  }
  return entries;
}

export function repositoryTreeExceedsGuestList(count: number) {
  return count > GUEST_FILE_LIST_LIMIT;
}
