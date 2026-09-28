import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";

import { ensureMemberProfilesRoot } from "./member-home-root";

let temporaryRoot: string | undefined;

afterEach(() => {
	if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
	temporaryRoot = undefined;
});

test("member home parents are traversable but cannot be listed", () => {
	temporaryRoot = mkdtempSync(join(tmpdir(), "codev-member-homes-"));

	const profilesRoot = ensureMemberProfilesRoot(temporaryRoot);

	expect(statSync(temporaryRoot).mode & 0o777).toBe(0o711);
	expect(statSync(profilesRoot).mode & 0o777).toBe(0o711);
});
