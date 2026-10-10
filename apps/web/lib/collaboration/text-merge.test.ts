import { describe, expect, it } from "vitest";

import { applyTextHunks, rebaseTextHunks } from "./text-merge";

function merge(base: string, ours: string, theirs: string) {
  const hunks = rebaseTextHunks(base, ours, theirs);
  return hunks ? applyTextHunks(ours, hunks) : null;
}

describe("rebaseTextHunks", () => {
  it("keeps a member's edit and an agent's edit on different lines", () => {
    expect(merge("a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n")).toBe("A\nb\nC\n");
  });

  it("keeps both when each added text at the same place", () => {
    expect(merge("", "t", "rocket 🚀\n")).toBe("trocket 🚀\n");
    expect(merge("a\n", "a\nmine\n", "a\ntheirs\n")).toBe("a\nmine\ntheirs\n");
  });

  it("applies the agent's change when the member changed nothing", () => {
    expect(merge("x\n", "x\n", "y\n")).toBe("y\n");
  });

  it("asks a person when both changed the same line", () => {
    expect(merge("a\nb\n", "a\nmine\n", "a\ntheirs\n")).toBeNull();
  });

  it("never deletes text a member inserted right after the agent's change", () => {
    expect(merge("a\nb\n", "a\nnew\nb\n", "A\nb\n")).toBe("A\nnew\nb\n");
  });
});
