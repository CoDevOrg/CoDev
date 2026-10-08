import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MAX_CHANGED_FILES,
	readChangeSet,
	symbolFromHunkContext,
	symbolsByPath,
} from "./change-set";

const SOURCE =
	"export function alpha() {\n\treturn 1;\n}\n\nexport function beta() {\n\treturn 2;\n}\n";

let temp: string;
let root: string;
let worktree: string;

function git(cwd: string, ...args: string[]) {
	return execFileSync(
		"git",
		[
			"-C",
			cwd,
			"-c",
			"user.email=test@example.test",
			"-c",
			"user.name=Test",
			...args,
		],
		{
			stdio: "pipe",
		},
	);
}

beforeEach(async () => {
	temp = await realpath(await mkdtemp(join(tmpdir(), "codev-change-set-")));
	root = join(temp, "repo");
	worktree = join(root, "agent-one");
	await mkdir(join(root, "src"), { recursive: true });
	git(root, "init", "-q");
	await writeFile(join(root, "src", "math.ts"), SOURCE);
	await writeFile(join(root, "README.md"), "readme\n");
	await writeFile(join(root, ".gitignore"), "agent-one/\n");
	git(root, "add", ".");
	git(root, "commit", "-qm", "base");
	git(root, "worktree", "add", "-qb", "agent-one", worktree);
});

afterEach(async () => {
	await rm(temp, { recursive: true, force: true });
});

describe("readChangeSet", () => {
	it("reports committed, uncommitted, deleted, and untracked changes since the primary checkout", async () => {
		await writeFile(
			join(worktree, "src", "math.ts"),
			SOURCE.replace("return 1", "return 10"),
		);
		git(worktree, "commit", "-qam", "alpha");
		await writeFile(
			join(worktree, "src", "math.ts"),
			SOURCE.replace("return 1", "return 10").replace("return 2", "return 20"),
		);
		await rm(join(worktree, "README.md"));
		await writeFile(
			join(worktree, "src", "new.ts"),
			"export const gamma = 3;\n",
		);

		expect(await readChangeSet(worktree, root)).toEqual({
			state: "known",
			symbolsKnown: true,
			files: [
				{ path: "README.md", symbols: [] },
				{ path: "src/math.ts", symbols: ["alpha", "beta"] },
				{ path: "src/new.ts", symbols: [] },
			],
		});
	});

	it("ignores commits that the primary checkout already has", async () => {
		await writeFile(
			join(root, "src", "math.ts"),
			SOURCE.replace("return 2", "return 22"),
		);
		git(root, "commit", "-qam", "primary moves on");

		expect(await readChangeSet(worktree, root)).toEqual({
			state: "known",
			symbolsKnown: true,
			files: [],
		});
	});

	it("reports only uncommitted work for the primary checkout itself", async () => {
		await writeFile(
			join(root, "src", "math.ts"),
			SOURCE.replace("return 2", "return 22"),
		);

		expect(await readChangeSet(root, root)).toEqual({
			state: "known",
			symbolsKnown: true,
			files: [{ path: "src/math.ts", symbols: ["beta"] }],
		});
	});

	it("drops paths with control characters", async () => {
		await writeFile(join(worktree, "bad\nname.ts"), "x\n");

		expect(await readChangeSet(worktree, root)).toEqual({
			state: "known",
			symbolsKnown: true,
			files: [],
		});
	});

	it("reports a large change instead of listing every path", async () => {
		await mkdir(join(worktree, "generated"));
		await Promise.all(
			Array.from({ length: MAX_CHANGED_FILES + 1 }, (_, index) =>
				writeFile(join(worktree, "generated", `${index}.txt`), "x\n"),
			),
		);

		expect(await readChangeSet(worktree, root)).toEqual({ state: "large" });
	});

	it("does not run a repository-configured fsmonitor command", async () => {
		const marker = join(temp, "fsmonitor-ran");
		git(root, "config", "core.fsmonitor", `touch ${marker}; false`);
		await writeFile(
			join(worktree, "src", "math.ts"),
			SOURCE.replace("return 1", "return 10"),
		);

		await readChangeSet(worktree, root);

		expect(existsSync(marker)).toBe(false);
	});

	it("fails for a worktree with no commits", async () => {
		const empty = join(temp, "empty");
		await mkdir(empty);
		git(empty, "init", "-q");

		await expect(readChangeSet(empty, empty)).rejects.toThrow();
	});
});

describe("symbolFromHunkContext", () => {
	it.each([
		["export async function refreshToken(token: string) {", "refreshToken"],
		["class SessionStore extends Store {", "SessionStore"],
		["export const handler = async (request) => {", "handler"],
		["def load(self, path):", "load"],
		["pub fn parse<T>(input: &str) -> T {", "parse"],
		["func (r *Repo) Save(ctx context.Context) error {", "Save"],
		["public static void main(String[] args) {", "main"],
		["if (ready) {", undefined],
		["", undefined],
	])("reads %p", (context, expected) => {
		expect(symbolFromHunkContext(context)).toBe(expected);
	});

	it("rejects names that do not look like identifiers", () => {
		expect(
			symbolFromHunkContext(`function ${"a".repeat(81)}() {`),
		).toBeUndefined();
	});
});

describe("symbolsByPath", () => {
	it("skips quoted paths and keeps deleted files under their old path", () => {
		const diff = [
			'diff --git "a/odd\\"name.ts" "b/odd\\"name.ts"',
			'--- "a/odd\\"name.ts"',
			'+++ "b/odd\\"name.ts"',
			"@@ -1 +1 @@ function odd() {",
			"diff --git a/gone.ts b/gone.ts",
			"--- a/gone.ts",
			"+++ /dev/null",
			"@@ -1,3 +0,0 @@ function gone() {",
		].join("\n");

		expect(
			[...symbolsByPath(diff)].map(([path, symbols]) => [path, [...symbols]]),
		).toEqual([["gone.ts", ["gone"]]]);
	});
});
