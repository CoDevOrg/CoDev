import { describe, expect, it } from "vitest";

import { withPrimaryWorktree, worktreeDisplay } from "./worktree-display";

describe("worktree display", () => {
  it("keeps the primary checkout listed when the guest omits a detached one", () => {
    expect(
      withPrimaryWorktree([{ worktreeId: "yousefs", branch: "main" }]),
    ).toEqual([
      { worktreeId: "main", branch: "HEAD" },
      { worktreeId: "yousefs", branch: "main" },
    ]);
    const listed = [{ worktreeId: "main", branch: "main" }];
    expect(withPrimaryWorktree(listed)).toBe(listed);
  });

  it("adds the worktree's name only when its branch alone is ambiguous", () => {
    const text = (worktreeId: string, branch: string) =>
      worktreeDisplay({ worktreeId, branch }).text;
    expect(text("main", "main")).toBe("main");
    expect(text("main", "HEAD")).toBe("detached HEAD (primary)");
    expect(text("yousefs", "main")).toBe("main (yousefs)");
    expect(text("feature-auth", "feature/auth")).toBe("feature/auth");
    expect(text("feature-auth-2", "feature/auth")).toBe("feature/auth");
    expect(text("agent-0a1b", "codev/agent-0a1b")).toBe("codev/agent-0a1b");
    expect(text("m", "main")).toBe("main (m)");
  });
});
