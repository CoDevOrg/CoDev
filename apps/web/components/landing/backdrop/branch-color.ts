import type { TreeLine } from "./tree-geometry";

/** Keep each selected branch and its descendants warm throughout growth. */
export function isWarmBranch(line: TreeLine): boolean {
  return Math.sin(line.rootX * 1234) > 0.7;
}
