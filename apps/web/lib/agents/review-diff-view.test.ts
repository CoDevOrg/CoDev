import { describe, expect, it } from "vitest";

import {
  BINARY_OMITTED_DETAIL,
  BINARY_SAFE_NOTE,
  summarizeReviewDiff,
} from "./review-diff-view";

const TEXT_AND_BINARY_DIFF = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,9 @@
 hello
+added one
+added two
-old line
+new line
diff --git a/src/hello.ts b/src/hello.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/hello.ts
@@ -0,0 +1,6 @@
+export const hello = "world";
+export const again = true;
diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..4444444
Binary files /dev/null and b/assets/logo.png differ
diff --git a/secret.bin b/secret.bin
index 5555555..6666666 100644
GIT binary patch
literal 12
zcmV-00a&K)0i|tQ
`;

describe("summarizeReviewDiff", () => {
  it("maps text deltas and omits binary patch content", () => {
    const summary = summarizeReviewDiff(TEXT_AND_BINARY_DIFF);

    expect(summary.summary).toBe(
      "4 paths changed · 2 text files · 2 binary files",
    );
    expect(summary.additions).toBe(5);
    expect(summary.deletions).toBe(1);
    expect(summary.paths).toEqual([
      {
        path: "README.md",
        kind: "modified",
        detail: "+3 −1 lines",
      },
      {
        path: "src/hello.ts",
        kind: "added",
        detail: "+2 −0 lines",
      },
      {
        path: "assets/logo.png",
        kind: "binary",
        detail: BINARY_OMITTED_DETAIL,
      },
      {
        path: "secret.bin",
        kind: "binary",
        detail: BINARY_OMITTED_DETAIL,
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain("GIT binary patch");
    expect(JSON.stringify(summary)).not.toContain("zcmV-00a&K)0i|tQ");
    expect(JSON.stringify(summary)).not.toContain("literal 12");
    expect(BINARY_SAFE_NOTE).toContain(
      "Binary content is not rendered as text",
    );
  });

  it("returns an empty summary for an unchanged worktree", () => {
    expect(summarizeReviewDiff("")).toEqual({
      summary: "0 paths changed · 0 text files · 0 binary files",
      additions: 0,
      deletions: 0,
      paths: [],
    });
  });
});
