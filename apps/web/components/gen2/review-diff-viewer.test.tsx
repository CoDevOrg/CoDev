import { render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ malformed: false, scrollTo: vi.fn() }));

vi.mock("@pierre/diffs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pierre/diffs")>();
  return {
    ...actual,
    parsePatchFiles: (...args: Parameters<typeof actual.parsePatchFiles>) => {
      if (mocks.malformed) throw new Error("malformed patch");
      return actual.parsePatchFiles(...args);
    },
  };
});

vi.mock("@pierre/diffs/react", () => ({
  CodeView: forwardRef(function CodeView(
    { items }: { items: Array<{ id: string }> },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ scrollTo: mocks.scrollTo }));
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
  afterEach(() => {
    mocks.malformed = false;
  });

  it("falls back to a readable patch when Pierre cannot parse it", () => {
    mocks.malformed = true;
    render(
      <ReviewDiffViewer
        layout="unified"
        patch={"diff --git a/a.ts b/a.ts\n+added\n-removed\n"}
      />,
    );
    const diff = screen.getByLabelText("Working tree diff");
    expect(diff).toHaveTextContent("+added");
    expect(diff.querySelector('[data-kind="add"]')).toHaveTextContent("+added");
    expect(diff.querySelector('[data-kind="remove"]')).toHaveTextContent(
      "-removed",
    );
  });

  it("scrolls to the requested file once per request", async () => {
    const { rerender } = render(
      <ReviewDiffViewer
        patch={PATCH}
        layout="unified"
        focusPath={{ path: "src/b.ts", id: 1 }}
      />,
    );
    await waitFor(() =>
      expect(mocks.scrollTo).toHaveBeenCalledWith({
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
    expect(mocks.scrollTo).toHaveBeenCalledTimes(1);
  });
});
