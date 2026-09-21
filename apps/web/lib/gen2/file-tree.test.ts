import { describe, expect, it } from "vitest";

import {
  ancestorDirectories,
  buildGen2FileTree,
  gen2StatusLabel,
} from "./file-tree";

describe("buildGen2FileTree", () => {
  it("nests flat paths and puts directories first", () => {
    const tree = buildGen2FileTree([
      { path: "README.md", status: null },
      { path: "src/b.ts", status: null },
      { path: "src/a.ts", status: "M" },
      { path: "src/deep/c.ts", status: null },
    ]);
    expect(tree.map((node) => node.name)).toEqual(["src", "README.md"]);
    const src = tree[0];
    if (src?.kind !== "directory") throw new Error("expected a directory");
    expect(src.children.map((child) => child.name)).toEqual([
      "deep",
      "a.ts",
      "b.ts",
    ]);
  });

  it("marks a directory when something beneath it changed", () => {
    const tree = buildGen2FileTree([
      { path: "src/deep/c.ts", status: "??" },
      { path: "docs/d.md", status: null },
    ]);
    const byName = Object.fromEntries(tree.map((node) => [node.name, node]));
    expect(byName.src).toMatchObject({ changed: true });
    expect(byName.docs).toMatchObject({ changed: false });
  });

  it("carries the git status onto the leaf", () => {
    const [file] = buildGen2FileTree([{ path: "a.ts", status: "M" }]);
    expect(file).toEqual({
      kind: "file",
      name: "a.ts",
      path: "a.ts",
      status: "M",
    });
  });

  it("handles an empty workspace", () => {
    expect(buildGen2FileTree([])).toEqual([]);
  });
});

describe("ancestorDirectories", () => {
  it("lists every directory on the way to a file", () => {
    expect(ancestorDirectories("src/deep/c.ts")).toEqual(["src", "src/deep"]);
    expect(ancestorDirectories("README.md")).toEqual([]);
  });
});

describe("gen2StatusLabel", () => {
  it("names the porcelain codes a member will actually see", () => {
    expect(gen2StatusLabel("M")).toBe("Modified");
    expect(gen2StatusLabel("??")).toBe("Untracked");
    expect(gen2StatusLabel("XY")).toBe("Changed");
  });
});
