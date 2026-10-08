import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { workspaceGitSpawnOptions } from "../runtime/git/workspace-git-identity";

export const MAX_CHANGED_FILES = 500;
const MAX_DIFF_BYTES = 5 * 1024 * 1024;
const GIT_TIMEOUT_MS = 10_000;
const SYMBOL_PATTERN = /^[A-Za-z_$][\w$.:-]{0,79}$/;
const NON_SYMBOLS = new Set([
	"if",
	"for",
	"while",
	"switch",
	"catch",
	"return",
	"function",
	"func",
	"async",
	"await",
	"new",
	"typeof",
]);

export type ChangedFile = { path: string; symbols: string[] };
export type ChangeSet =
	| { state: "known"; files: ChangedFile[]; symbolsKnown: boolean }
	| { state: "large" };

/** Repository Git with config-named commands disabled, as codev-shell on a guest. */
function runGit(cwd: string, args: string[], maxBuffer = 1024 * 1024) {
	return promisify(execFile)(
		"git",
		[
			"-c",
			"core.fsmonitor=false",
			"-c",
			"safe.directory=*",
			"-C",
			cwd,
			...args,
		],
		{
			...workspaceGitSpawnOptions(),
			timeout: GIT_TIMEOUT_MS,
			maxBuffer,
			env: {
				...process.env,
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_OPTIONAL_LOCKS: "0",
			},
		},
	).then(({ stdout }) => stdout);
}

function isSafeRelativePath(path: string) {
	return (
		path.length > 0 &&
		path.length <= 1024 &&
		!path.startsWith("/") &&
		[...path].every((char) => char >= " " && char !== "\u007f") &&
		path
			.split("/")
			.every((part) => part !== "" && part !== "." && part !== "..")
	);
}

export function symbolFromHunkContext(context: string): string | undefined {
	const declared =
		/\b(?:class|interface|type|enum|struct|trait|impl|mod|module|namespace|def|fn|func|function)\s+([A-Za-z_$][\w$.:]*)/.exec(
			context,
		)?.[1];
	const assigned = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/.exec(
		context,
	)?.[1];
	const called = [
		...context.matchAll(/([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(/g),
	]
		.map((match) => match[1])
		.find((name) => name !== undefined && !NON_SYMBOLS.has(name));
	const name = declared ?? assigned ?? called;
	return name && SYMBOL_PATTERN.test(name) ? name : undefined;
}

/** Maps each file in a `git diff -U0` to the enclosing symbols Git reports for its hunks. */
export function symbolsByPath(diff: string) {
	const symbols = new Map<string, Set<string>>();
	let removedPath: string | undefined;
	let currentPath: string | undefined;
	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) {
			removedPath = currentPath = undefined;
		} else if (line.startsWith("--- ")) {
			removedPath = line.startsWith("--- a/") ? line.slice(6) : undefined;
		} else if (line.startsWith("+++ ")) {
			currentPath = line.startsWith("+++ b/")
				? line.slice(6)
				: line === "+++ /dev/null"
					? removedPath
					: undefined;
		} else if (line.startsWith("@@ ") && currentPath) {
			const symbol = symbolFromHunkContext(line.replace(/^@@ [^@]* @@ ?/, ""));
			if (!symbol) continue;
			symbols.set(
				currentPath,
				(symbols.get(currentPath) ?? new Set()).add(symbol),
			);
		}
	}
	return symbols;
}

function nulSeparated(output: string) {
	return output.split("\0").filter(Boolean);
}

/**
 * Paths and enclosing symbols changed in one worktree since it diverged from
 * the primary checkout, including uncommitted and untracked files. File
 * contents are read by Git only to locate hunks and are never returned.
 */
export async function readChangeSet(
	worktreeRoot: string,
	primaryRoot: string,
): Promise<ChangeSet> {
	const primaryHead = (
		await runGit(primaryRoot, ["rev-parse", "--verify", "HEAD"])
	).trim();
	const base = (
		await runGit(worktreeRoot, ["merge-base", "HEAD", primaryHead])
	).trim();
	const tracked = nulSeparated(
		await runGit(worktreeRoot, [
			"diff",
			"--no-ext-diff",
			"--no-textconv",
			"--no-renames",
			"--name-only",
			"-z",
			base,
		]),
	);
	const untracked = nulSeparated(
		await runGit(worktreeRoot, [
			"ls-files",
			"--others",
			"--exclude-standard",
			"-z",
		]),
	);
	const paths = [...new Set([...tracked, ...untracked])]
		.filter(isSafeRelativePath)
		.sort();
	if (paths.length > MAX_CHANGED_FILES) return { state: "large" };

	const diff = await runGit(
		worktreeRoot,
		[
			"-c",
			"core.quotePath=false",
			"diff",
			"--no-ext-diff",
			"--no-textconv",
			"--no-renames",
			"--no-color",
			"-U0",
			base,
		],
		MAX_DIFF_BYTES,
	).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return undefined;
		throw error;
	});
	const symbols =
		diff === undefined ? new Map<string, Set<string>>() : symbolsByPath(diff);
	return {
		state: "known",
		symbolsKnown: diff !== undefined,
		files: paths.map((path) => ({
			path,
			symbols: [...(symbols.get(path) ?? [])].sort(),
		})),
	};
}

export async function readCurrentBranch(worktreeRoot: string) {
	return (
		(await runGit(worktreeRoot, ["branch", "--show-current"])).trim() ||
		undefined
	);
}
