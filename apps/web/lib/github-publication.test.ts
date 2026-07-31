import { describe, expect, it } from "vitest";

import {
  buildCreateTreeRequest,
  buildDeletedTreeEntries,
} from "./github-publication";

describe("GitHub publication tree construction", () => {
  it("bases exported changes on the parent tree", () => {
    const tree = [
      {
        path: "src/app.ts",
        mode: "100644" as const,
        type: "blob" as const,
        sha: "blob-sha",
      },
    ];

    expect(
      buildCreateTreeRequest({
        owner: "acme",
        repo: "demo",
        baseTreeSha: "base-tree-sha",
        tree,
      }),
    ).toEqual({
      owner: "acme",
      repo: "demo",
      base_tree: "base-tree-sha",
      tree,
    });
  });

  it("can encode deleted files while preserving the parent tree", () => {
    const tree = buildDeletedTreeEntries(
      [
        { path: "removed.ts", mode: "100644", type: "blob" },
        { path: "kept.ts", mode: "100644", type: "blob" },
        { path: "src", mode: "040000", type: "tree" },
      ],
      new Set(["kept.ts"]),
    );

    expect(
      buildCreateTreeRequest({
        owner: "acme",
        repo: "demo",
        baseTreeSha: "base-tree-sha",
        tree,
      }).tree,
    ).toEqual(tree);
  });
});
