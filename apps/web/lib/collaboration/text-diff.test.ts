import { describe, expect, it } from "vitest";

import { diffTextHunks } from "./text-diff";

function apply(before: string, after: string) {
  return [...diffTextHunks(before, after)]
    .reverse()
    .reduce(
      (text, hunk) =>
        text.slice(0, hunk.from) + hunk.insert + text.slice(hunk.to),
      before,
    );
}

describe("diffTextHunks", () => {
  it("returns nothing for identical text", () => {
    expect(diffTextHunks("same\n", "same\n")).toEqual([]);
  });

  it("keeps unchanged middle lines out of the hunks", () => {
    const before = "one\ntwo\nthree\nfour\n";
    const after = "ONE\ntwo\nthree\nfour\nfive\n";
    expect(diffTextHunks(before, after)).toEqual([
      { from: 0, to: 4, insert: "ONE\n" },
      { from: 19, to: 19, insert: "five\n" },
    ]);
  });

  it.each([
    ["", "new file\n"],
    ["gone\n", ""],
    ["no newline", "no newline\n"],
    ["x\ny\nz", "y\nx\nz\nw"],
  ])("reconstructs %j → %j", (before, after) => {
    expect(apply(before, after)).toBe(after);
  });

  it("falls back to one hunk for very large rewrites", () => {
    const before = Array.from({ length: 600 }, (_, i) => `a${i}\n`).join("");
    const after = Array.from({ length: 600 }, (_, i) => `b${i}\n`).join("");
    expect(diffTextHunks(before, after)).toHaveLength(1);
    expect(apply(before, after)).toBe(after);
  });
});
