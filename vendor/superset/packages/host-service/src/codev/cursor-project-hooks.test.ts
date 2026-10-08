import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCursorProjectHookFile } from "./cursor-project-hooks";

let root: string;

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("findCursorProjectHookFile", () => {
	it("finds each file Cursor would load hooks from, including dangling links", async () => {
		root = await mkdtemp(join(tmpdir(), "cursor-hooks-"));
		expect(await findCursorProjectHookFile(root)).toBeUndefined();

		await mkdir(join(root, ".claude"));
		await symlink("/missing", join(root, ".claude", "settings.local.json"));
		expect(await findCursorProjectHookFile(root)).toBe(
			".claude/settings.local.json",
		);

		await mkdir(join(root, ".cursor"));
		await writeFile(join(root, ".cursor", "hooks.json"), "{}");
		expect(await findCursorProjectHookFile(root)).toBe(".cursor/hooks.json");
	});
});
