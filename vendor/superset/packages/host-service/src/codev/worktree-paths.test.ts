import { expect, test } from "bun:test";
import { parseCoDevWorktrees } from "./worktree-paths";

const root = "/workspace";
const porcelain = [
	"worktree /workspace",
	"HEAD abc",
	"branch refs/heads/master",
	"",
	"worktree /workspace/test-2",
	"HEAD def",
	"branch refs/heads/test-2",
	"",
	"worktree /workspace/.git/codev-agent-worktrees/feature-3",
	"HEAD ghi",
	"branch refs/heads/feature-3",
	"",
	"worktree /workspace/nested/hidden",
	"HEAD jkl",
	"branch refs/heads/hidden",
	"",
	"worktree /other-repository/foreign",
	"HEAD mno",
	"branch refs/heads/foreign",
	"",
].join("\n");

test("shows primary, agent-created direct children, and managed worktrees", () => {
	expect(
		parseCoDevWorktrees(porcelain, root).map(({ worktreeId, branch }) => ({
			worktreeId,
			branch,
		})),
	).toEqual([
		{ worktreeId: "feature-3", branch: "feature-3" },
		{ worktreeId: "main", branch: "master" },
		{ worktreeId: "test-2", branch: "test-2" },
	]);
});

test("does not expose nested paths, unsafe names, or duplicate ids", () => {
	const list = `${porcelain}\nworktree /workspace/Test_Name\nHEAD abc\nbranch refs/heads/x\n\nworktree /workspace/.git/codev-agent-worktrees/test-2\nHEAD abc\nbranch refs/heads/x\n`;
	expect(
		parseCoDevWorktrees(list, root).filter(
			(entry) => entry.worktreeId === "test-2",
		),
	).toHaveLength(1);
	expect(
		parseCoDevWorktrees(list, root).some(
			(entry) => entry.worktreeId === "Test_Name",
		),
	).toBe(false);
});

test("keeps a detached checkout, reporting its branch as HEAD", () => {
	const list = [
		"worktree /workspace",
		"HEAD beb6747804",
		"detached",
		"",
		"worktree /workspace/.git/codev-agent-worktrees/yousefs",
		"HEAD beb6747804",
		"branch refs/heads/main",
		"",
		"worktree /workspace/bare-mirror",
		"bare",
		"",
	].join("\n");
	expect(
		parseCoDevWorktrees(list, root).map(({ worktreeId, branch }) => ({ worktreeId, branch })),
	).toEqual([
		{ worktreeId: "main", branch: "HEAD" },
		{ worktreeId: "yousefs", branch: "main" },
	]);
});
