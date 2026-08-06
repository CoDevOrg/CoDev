import { describe, expect, it } from "vitest";

import {
  branchWorktreeName,
  deriveBranchSessionName,
  selectTurnsThroughReply,
} from "./agent-branch";

describe("agent branch helpers", () => {
  it("selects turns through the branch point", () => {
    const turns = [
      { id: "t1", prompt: "one", status: "completed", output: "a", lastError: null },
      { id: "t2", prompt: "two", status: "completed", output: "b", lastError: null },
      { id: "t3", prompt: "three", status: "completed", output: "c", lastError: null },
    ];
    expect(selectTurnsThroughReply(turns, "t2").map((turn) => turn.id)).toEqual([
      "t1",
      "t2",
    ]);
    expect(() => selectTurnsThroughReply(turns, "missing")).toThrow(
      /not found/i,
    );
  });

  it("derives branch session and worktree names", () => {
    expect(deriveBranchSessionName("Investigate auth")).toBe(
      "Branch Investigate auth",
    );
    expect(branchWorktreeName("Branch Investigate auth", "abcd1234")).toBe(
      "agent-branch-investigate-auth-abcd1234",
    );
  });
});
