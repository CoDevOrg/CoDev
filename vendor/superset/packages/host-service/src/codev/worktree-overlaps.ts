import type { ChangedFile } from "./change-set";

export const MAX_REPORTED_OVERLAPS = 200;

export type WorktreeOverlap = {
	worktreeIds: [string, string];
	path: string;
	level: "file" | "function";
	symbols: string[];
};

/** Pairs worktrees that changed the same path, and the same symbols within it when known. */
export function findWorktreeOverlaps(
	worktrees: { worktreeId: string; files: ChangedFile[] }[],
): WorktreeOverlap[] {
	const sorted = [...worktrees].sort((left, right) =>
		left.worktreeId.localeCompare(right.worktreeId),
	);
	return sorted.flatMap((left, index) => {
		const leftFiles = new Map(
			left.files.map((file) => [file.path, file.symbols]),
		);
		return sorted.slice(index + 1).flatMap((right) =>
			right.files
				.filter((file) => leftFiles.has(file.path))
				.map((file): WorktreeOverlap => {
					const leftSymbols = new Set(leftFiles.get(file.path));
					const symbols = file.symbols.filter((symbol) =>
						leftSymbols.has(symbol),
					);
					return {
						worktreeIds: [left.worktreeId, right.worktreeId],
						path: file.path,
						level: symbols.length > 0 ? "function" : "file",
						symbols,
					};
				}),
		);
	});
}
