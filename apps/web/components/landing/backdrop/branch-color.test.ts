import { describe, expect, it } from "vitest";

import { isWarmBranch } from "./branch-color";
import { buildTree } from "./tree-geometry";

describe("branch accents", () => {
  it("keeps a minority of root branches warm, including their descendants", () => {
    const tree = buildTree();
    const roots = tree.filter((line) => line.depth === 0);
    const warm = roots.filter(isWarmBranch);
    expect(warm.length).toBeGreaterThan(0);
    expect(warm.length).toBeLessThanOrEqual(3);
    for (const root of roots) {
      for (const child of tree.filter((line) => line.rootX === root.rootX)) {
        expect(isWarmBranch(child)).toBe(isWarmBranch(root));
      }
    }
  });
});
