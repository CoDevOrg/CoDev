import { render, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";

const scrollTo = vi.hoisted(() => vi.fn());

vi.mock("@pierre/diffs/react", () => ({
  CodeView: forwardRef(function CodeView(
    { items }: { items: Array<{ id: string }> },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ scrollTo }));
    return (
      <ol>
        {items.map((item) => (
          <li key={item.id}>{item.id}</li>
        ))}
      </ol>
    );
  }),
}));

import { ReviewDiffViewer } from "./review-diff-viewer";

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-a",
  "+b",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1 @@",
  "-c",
  "+d",
  "",
].join("\n");

describe("ReviewDiffViewer", () => {
  it("scrolls to the requested file once per request", async () => {
    const { rerender } = render(
      <ReviewDiffViewer
        patch={PATCH}
        layout="unified"
        focusPath={{ path: "src/b.ts", id: 1 }}
      />,
    );
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith({
        type: "item",
        id: expect.stringMatching(/^src\/b\.ts:/),
        align: "start",
      }),
    );
    rerender(
      <ReviewDiffViewer
        patch={PATCH}
        layout="split"
        focusPath={{ path: "src/b.ts", id: 1 }}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
