import { describe, expect, it } from "vitest";

import { parseReviewDiff } from "./parse-review-diff";

describe("parseReviewDiff", () => {
  it("returns an empty list for blank diffs", () => {
    expect(parseReviewDiff("")).toEqual([]);
    expect(parseReviewDiff("   ")).toEqual([]);
  });

  it("summarizes each file with add/delete counts", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,3 @@",
      " keep",
      "-old",
      "+new",
      "+extra",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1 +1 @@",
      "-gone",
      "+here",
    ].join("\n");

    expect(parseReviewDiff(diff)).toEqual([
      {
        path: "src/a.ts",
        additions: 2,
        deletions: 1,
        hunk: expect.stringContaining("diff --git a/src/a.ts b/src/a.ts"),
      },
      {
        path: "src/b.ts",
        additions: 1,
        deletions: 1,
        hunk: expect.stringContaining("diff --git a/src/b.ts b/src/b.ts"),
      },
    ]);
  });
});
