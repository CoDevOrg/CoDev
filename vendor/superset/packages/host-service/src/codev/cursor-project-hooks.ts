import { lstat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Project files the Cursor CLI always reads hooks from, with no flag to turn
 * them off. Any workspace member can write them, and a hook would run with the
 * launching member's credentials, so a Cursor agent never starts beside one.
 */
const CURSOR_PROJECT_HOOK_FILES = [
	".cursor/hooks.json",
	".claude/settings.json",
	".claude/settings.local.json",
];

/** The first project hook file present in `root`, counting dangling links. */
export async function findCursorProjectHookFile(root: string) {
	for (const file of CURSOR_PROJECT_HOOK_FILES) {
		const present = await lstat(join(root, file)).then(
			() => true,
			() => false,
		);
		if (present) return file;
	}
	return undefined;
}
