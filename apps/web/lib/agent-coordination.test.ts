import { describe, expect, it } from "vitest";

import {
  claimCoversPath,
  claimPatternsOverlap,
  claimSerializationScope,
} from "./agent-coordination";

describe("path claim matching", () => {
  it("detects exact and directory overlaps", () => {
    expect(claimPatternsOverlap("src/index.ts", "src/index.ts")).toBe(true);
    expect(claimPatternsOverlap("src/**", "src/lib/parser.ts")).toBe(true);
    expect(claimPatternsOverlap("src/**", "src/lib/**")).toBe(true);
    expect(claimPatternsOverlap("src/**", "tests/index.ts")).toBe(false);
  });

  it("matches writes only inside the claimed directory", () => {
    expect(claimCoversPath("src/**", "src/index.ts")).toBe(true);
    expect(claimCoversPath("src/**", "source/index.ts")).toBe(false);
    expect(claimCoversPath("README.md", "README.md")).toBe(true);
  });

  it("shares one serialized claim namespace across workspace worktrees", () => {
    expect(claimSerializationScope("workspace-id")).toBe(
      "workspace:workspace-id",
    );
  });
});
