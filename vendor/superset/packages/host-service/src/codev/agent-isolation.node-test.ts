import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	agentLaunchScript,
	buildCoDevAgentProfile,
	COORDINATION_HOOK_COMMAND,
	prepareAgentLaunch,
	removeAgentLaunch,
	validateAgentLaunchProfile,
} from "./agent-isolation.ts";

test("launch script quotes every argument and exports profile environment", () => {
	const script = agentLaunchScript("/private/agent's-dir", ["codex", "exec", "a'$(id)`b"], {
		CODEX_HOME: "{{profileDir}}/.codex",
		CLAUDE_CODE_OAUTH_TOKEN: "test-only-token",
	});
	assert.match(script, /export CODEX_HOME='\/private\/agent'\\''s-dir\/.codex'/);
	assert.match(script, /export CLAUDE_CODE_OAUTH_TOKEN='test-only-token'/);
	assert.match(script, /'a'\\''\$\(id\)`b'/);
	assert.match(script, /umask 0002/);
});

test("launch profiles cannot escape the private directory or inject shell environment names", () => {
	assert.throws(
		() => validateAgentLaunchProfile({ files: [{ path: "../auth.json", contents: "secret" }] }),
		/relative to the profile/,
	);
	assert.throws(
		() => validateAgentLaunchProfile({ files: [{ path: "a\\auth.json", contents: "secret" }] }),
		/relative to the profile/,
	);
	assert.throws(
		() => validateAgentLaunchProfile({ env: { "BAD-NAME": "secret" } }),
		/environment names/,
	);
});

test("CoDev installs provider hooks beside the private credential profile", () => {
	const codex = buildCoDevAgentProfile(
		{ env: { CODEX_HOME: "{{profileDir}}/.codex" } },
		"openai",
	);
	const claude = buildCoDevAgentProfile({}, "anthropic");
	const codexHooks = JSON.parse(codex.files?.[0]?.contents ?? "{}") as {
		hooks?: Record<string, unknown>;
	};

	assert.equal(codex.files?.[0]?.path, ".codex/hooks.json");
	assert.ok(codexHooks.hooks?.SessionStart);
	assert.ok(codexHooks.hooks?.SubagentStart);
	assert.equal(claude.files?.[0]?.path, ".claude/settings.json");
	assert.equal(claude.env?.CLAUDE_CONFIG_DIR, "{{profileDir}}/.claude");
	for (const profile of [codex, claude]) {
		const { hooks } = JSON.parse(profile.files?.[0]?.contents ?? "{}") as {
			hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
		};
		const commands = (name: string) =>
			(hooks[name] ?? []).flatMap((entry) => entry.hooks.map((hook) => hook.command));
		assert.ok(commands("PostToolUse").includes(COORDINATION_HOOK_COMMAND));
		assert.ok(!commands("Stop").includes(COORDINATION_HOOK_COMMAND));
	}
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
				prepareAgentLaunch({
					root,
					command: ["/usr/bin/true"],
					provider: "openai",
					hookToken: "a".repeat(64),
				}),
				/not provisioned safely/,
			);
			await chmod(root, 0o711);
			first = await prepareAgentLaunch({
				root,
				command: ["/usr/bin/printf", "%s", longArgument],
				provider: "openai",
				hookToken: "a".repeat(64),
				profile: {
					files: [{ path: ".codex/auth.json", contents: secret }],
					env: { CODEX_HOME: "{{profileDir}}/.codex" },
				},
			});
			second = await prepareAgentLaunch({
				root,
				command: ["/usr/bin/true"],
				provider: "anthropic",
				hookToken: "b".repeat(64),
			});
			assert.notEqual(first.uid, second.uid);
			assert.ok(first.command.length < 512);
			assert.equal((await stat(first.directory)).mode & 0o777, 0o700);
			assert.equal((await stat(join(first.directory, ".codex", "auth.json"))).mode & 0o777, 0o600);

			const runAs = (uid: number, command: string) =>
				spawnSync(
					"/usr/bin/setpriv",
					[`--reuid=${uid}`, "--regid=2000", "--clear-groups", "--", "/bin/sh", "-c", command],
					{ encoding: "utf8" },
				);
			assert.equal(runAs(2000, `test ! -r '${first.directory}/.codex/auth.json'`).status, 0);
			assert.equal(runAs(2000, `test ! -r '${first.directory}/launch.sh'`).status, 0);
			assert.equal(runAs(second.uid, `test ! -r '${first.directory}/.codex/auth.json'`).status, 0);
			assert.equal(runAs(second.uid, `test ! -r '${first.directory}/launch.sh'`).status, 0);
			assert.equal(runAs(first.uid, `test -r '${first.directory}/.codex/auth.json'`).status, 0);
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
