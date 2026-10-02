import { relative, resolve, sep } from "node:path";

export const CODEV_WORKTREE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function within(root: string, candidate: string) {
	const path = relative(root, candidate);
	return (
		path === "" ||
		(path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep))
	);
}

/** Only the primary, managed, and direct-child Git worktrees have stable UI ids. */
export function parseCoDevWorktrees(output: string, primaryRoot: string) {
	const root = resolve(primaryRoot);
	const managedRoot = resolve(root, ".git", "codev-agent-worktrees");
	const entries: Array<{ worktreeId: string; branch: string; path: string }> =
		[];
	const seen = new Set<string>();
	for (const block of output.trim().split(/\r?\n\r?\n/)) {
		const values = new Map(
			block.split(/\r?\n/).map((line) => {
				const [key, ...rest] = line.split(" ");
				return [key, rest.join(" ")];
			}),
		);
		const rawPath = values.get("worktree");
		if (!rawPath || !rawPath.startsWith("/")) continue;
		const path = resolve(rawPath);
		let worktreeId: string;
		if (path === root) worktreeId = "main";
		else if (
			within(managedRoot, path) &&
			relative(managedRoot, path).split(sep).length === 1
		)
			worktreeId = relative(managedRoot, path);
		else if (within(root, path) && relative(root, path).split(sep).length === 1)
			worktreeId = relative(root, path);
		else continue;
		if (
			worktreeId.length > 64 ||
			!CODEV_WORKTREE_ID_PATTERN.test(worktreeId) ||
			seen.has(worktreeId)
		)
			continue;
		const branchRef = values.get("branch") ?? "";
		if (!branchRef.startsWith("refs/heads/")) continue;
		seen.add(worktreeId);
		entries.push({ worktreeId, branch: branchRef.slice(11), path });
	}
	return entries.sort((left, right) =>
		left.worktreeId.localeCompare(right.worktreeId),
	);
}
