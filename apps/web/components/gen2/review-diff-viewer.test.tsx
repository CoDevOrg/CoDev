import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@pierre/diffs", () => ({
  parsePatchFiles: () => {
    throw new Error("malformed patch");
  },
}));

vi.mock("@pierre/diffs/react", () => ({
  CodeView: () => null,
}));

import { ReviewDiffViewer } from "./review-diff-viewer";

describe("ReviewDiffViewer", () => {
  it("falls back to a readable patch when Pierre cannot parse it", () => {
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
});
