import { expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveCoDevWorktreeRoot } from "./files";

test("resolves only Git-registered worktrees inside the workspace", async () => {
	const temp = await mkdtemp(join(tmpdir(), "codev-worktrees-"));
	const root = join(temp, "repo");
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
	try {
		await mkdir(root);
		git("init", "-q");
		git(
			"-c",
			"user.email=test@example.test",
			"-c",
			"user.name=Test",
			"commit",
			"--allow-empty",
			"-qm",
			"init",
		);
		git("worktree", "add", "-qb", "test-2", join(root, "test-2"));
		await mkdir(join(root, "unregistered"));
		expect(await resolveCoDevWorktreeRoot(root, "test-2")).toBe(
			await realpath(join(root, "test-2")),
		);
		await expect(
			resolveCoDevWorktreeRoot(root, "unregistered"),
		).rejects.toThrow("not registered");
		await symlink(temp, join(root, "escape"));
		await expect(resolveCoDevWorktreeRoot(root, "escape")).rejects.toThrow(
			"not registered",
		);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
});
