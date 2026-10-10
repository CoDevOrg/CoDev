import { describe, expect, it, vi } from "vitest";

import { branchBaseFor, createWorktreeFrom } from "./create-worktree";

const worktrees = [
  { worktreeId: "main", branch: "develop" },
  { worktreeId: "feat-a", branch: "feat/a" },
];

describe("branchBaseFor", () => {
  it("starts from the member's branch, or the primary checkout on main", () => {
    expect(branchBaseFor(worktrees[1]!, worktrees)).toEqual({
      baseRef: "feat/a",
      label: "feat/a",
    });
    expect(branchBaseFor(worktrees[0]!, worktrees)).toEqual({
      baseRef: undefined,
      label: "develop",
    });
    expect(branchBaseFor(worktrees[0]!, worktrees, "v1.2")).toEqual({
      baseRef: "v1.2",
      label: "v1.2",
    });
  });
});

describe("createWorktreeFrom", () => {
  it("names the worktree after the branch unless the form names it", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { worktree: { worktreeId: "feat-a-2", branch: "feat/a" } },
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await createWorktreeFrom(
      "ws-1",
      { branch: " feat/a ", baseRef: " " },
      worktrees,
    );
    await createWorktreeFrom(
      "ws-1",
      { branch: "x", worktreeId: " mine ", baseRef: "main" },
      worktrees,
    );
    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call as unknown as [string, RequestInit])[1].body)),
    );
    expect(bodies).toEqual([
      { worktreeId: "feat-a-2", branch: "feat/a" },
      { worktreeId: "mine", branch: "x", baseRef: "main" },
    ]);
  });
});
