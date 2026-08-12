import { describe, expect, it } from "vitest";

import {
  claimCoversPath,
  claimPatternsOverlap,
  claimSerializationScope,
} from "./agent-coordination";
import {
  AGENT_CAPACITY_EXCEEDED_MESSAGE,
  assertAgentCapacity,
  summarizeAgentCapacity,
} from "./agent-capacity";

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

describe("agent worktree capacity", () => {
  it("reserves exactly three slots and counts active or frozen worktrees", () => {
    expect(
      summarizeAgentCapacity([
        { worktreeStatus: "active" },
        { worktreeStatus: "frozen" },
        { worktreeStatus: "discarded" },
      ]),
    ).toEqual({
      maxActiveSessions: 3,
      activeSessions: 2,
      availableSlots: 1,
    });
  });

  it("does not expose a negative number of available slots", () => {
    expect(
      summarizeAgentCapacity([
        { worktreeStatus: "active" },
        { worktreeStatus: "active" },
        { worktreeStatus: "active" },
        { worktreeStatus: "active" },
      ]).availableSlots,
    ).toBe(0);
  });

  it("rejects a fourth session with actionable guidance", () => {
    expect(() => assertAgentCapacity(2)).not.toThrow();
    expect(() => assertAgentCapacity(3)).toThrow(
      AGENT_CAPACITY_EXCEEDED_MESSAGE,
    );
  });
});
