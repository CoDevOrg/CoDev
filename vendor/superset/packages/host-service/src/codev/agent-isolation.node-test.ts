import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { agentLaunchScript, prepareAgentLaunch, removeAgentLaunch } from "./agent-isolation.ts";

test("launch script quotes every argument and keeps the credential out of the command", () => {
	const script = agentLaunchScript("/private/agent's-dir", ["codex", "exec", "a'$(id)`b"], "{}");
	assert.match(script, /export CODEX_HOME='\/private\/agent'\\''s-dir'/);
	assert.match(script, /'a'\\''\$\(id\)`b'/);
	assert.ok(!script.includes("{}"));
	assert.match(script, /umask 0002/);
});

const canExerciseLinuxPermissions =
	process.platform === "linux" && process.getuid?.() === 0 && existsSync("/usr/bin/setpriv");

test(
	"one agent can read its long launch while the shell and a second agent cannot",
	{
		skip: !canExerciseLinuxPermissions,
	},
	async () => {
		const root = await mkdtemp(join(tmpdir(), "codev-agent-isolation-"));
		const secret = '{"tokens":{"access_token":"test-only"}}';
		const longArgument = `${"x".repeat(2_000)}'$(printf injected)`;
		let first: Awaited<ReturnType<typeof prepareAgentLaunch>> | undefined;
		let second: Awaited<ReturnType<typeof prepareAgentLaunch>> | undefined;
		try {
			await assert.rejects(
				prepareAgentLaunch({ root, command: ["/usr/bin/true"] }),
				/not provisioned safely/,
			);
			await chmod(root, 0o711);
			first = await prepareAgentLaunch({
				root,
				command: ["/usr/bin/printf", "%s", longArgument],
				authCacheJson: secret,
			});
			second = await prepareAgentLaunch({ root, command: ["/usr/bin/true"] });
			assert.notEqual(first.uid, second.uid);
			assert.ok(first.command.length < 512);
			assert.equal((await stat(first.directory)).mode & 0o777, 0o700);
			assert.equal((await stat(join(first.directory, "auth.json"))).mode & 0o777, 0o600);

			const runAs = (uid: number, command: string) =>
				spawnSync(
					"/usr/bin/setpriv",
					[`--reuid=${uid}`, "--regid=2000", "--clear-groups", "--", "/bin/sh", "-c", command],
					{ encoding: "utf8" },
				);
			assert.equal(runAs(2000, `test ! -r '${first.directory}/auth.json'`).status, 0);
			assert.equal(runAs(2000, `test ! -r '${first.directory}/launch.sh'`).status, 0);
			assert.equal(runAs(second.uid, `test ! -r '${first.directory}/auth.json'`).status, 0);
			assert.equal(runAs(second.uid, `test ! -r '${first.directory}/launch.sh'`).status, 0);
			assert.equal(runAs(first.uid, `test -r '${first.directory}/auth.json'`).status, 0);
			const launched = runAs(first.uid, first.command);
			assert.equal(launched.status, 0, launched.stderr);
			assert.equal(launched.stdout, longArgument);
		} finally {
			await removeAgentLaunch(first);
			await removeAgentLaunch(second);
			await rm(root, { recursive: true, force: true });
		}
	},
);
