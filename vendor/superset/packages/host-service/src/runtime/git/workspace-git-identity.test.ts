import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	chownSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUserSimpleGit } from "./simple-git";
import { workspaceGitSpawnOptions } from "./workspace-git-identity";

const originalRoot = process.env.CODEV_WORKSPACE_ROOT;

afterEach(() => {
	if (originalRoot === undefined) delete process.env.CODEV_WORKSPACE_ROOT;
	else process.env.CODEV_WORKSPACE_ROOT = originalRoot;
});

describe("workspaceGitSpawnOptions", () => {
	it("runs repository Git as codev-shell only when a CoDev guest host is root", () => {
		const uid = spyOn(process, "getuid");
		try {
			uid.mockReturnValue(0);
			process.env.CODEV_WORKSPACE_ROOT = "/workspace";
			expect(workspaceGitSpawnOptions()).toEqual({ uid: 2000, gid: 2000 });

			delete process.env.CODEV_WORKSPACE_ROOT;
			expect(workspaceGitSpawnOptions()).toEqual({});

			uid.mockReturnValue(501);
			process.env.CODEV_WORKSPACE_ROOT = "/workspace";
			expect(workspaceGitSpawnOptions()).toEqual({});
		} finally {
			uid.mockRestore();
		}
	});

	it.skipIf(!(process.platform === "linux" && process.getuid?.() === 0))(
		"keeps a repository-configured command from running as root",
		async () => {
			const root = mkdtempSync(join(tmpdir(), "codev-git-identity-"));
			const marker = join(root, "fsmonitor-uid");
			try {
				chmodSync(root, 0o777);
				execFileSync("git", ["init", "-q", root]);
				writeFileSync(join(root, "file.txt"), "x\n");
				execFileSync("git", [
					"-C",
					root,
					"config",
					"core.fsmonitor",
					`id -u > ${marker}; false`,
				]);
				execFileSync("chown", ["-R", "2000:2000", root]);
				chownSync(root, 2000, 2000);
				process.env.CODEV_WORKSPACE_ROOT = root;

				await createUserSimpleGit(root)
					.env({ PATH: process.env.PATH ?? "" })
					.raw(["-c", "safe.directory=*", "status"]);

				expect(readFileSync(marker, "utf8").trim()).toBe("2000");
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		},
	);
});
