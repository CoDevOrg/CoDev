import { describe, expect, it } from "vitest";

import { hasUnpublishedRuntimeChanges } from "./workspace-lifecycle";

describe("workspace lifecycle baselines", () => {
  it("treats an untouched credential-free snapshot as clean", () => {
    expect(
      hasUnpublishedRuntimeChanges(
        "synthetic-private-head",
        "synthetic-private-head",
        "github-base-head",
      ),
    ).toBe(false);
  });

  it("detects changes after the sandbox baseline", () => {
    expect(
      hasUnpublishedRuntimeChanges(
        "edited-head",
        "synthetic-private-head",
        "github-base-head",
      ),
    ).toBe(true);
  });

  it("falls back to the repository base for existing runtimes", () => {
    expect(
      hasUnpublishedRuntimeChanges(
        "github-base-head",
        null,
        "github-base-head",
      ),
    ).toBe(false);
  });
});
