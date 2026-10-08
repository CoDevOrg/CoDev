import { randomInt } from "node:crypto";
import { chown, chmod, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Reserved for CoDev agent processes. Ordinary terminals always use uid 2000.
const MIN_AGENT_UID = 100_000;
const MAX_AGENT_UID = 2_147_483_647;
const WORKSPACE_GID = 2000;
const MAX_PROFILE_FILES = 8;
const MAX_PROFILE_FILE_BYTES = 128 << 10;
const MAX_PROFILE_ENV_VARS = 16;
const MAX_PROFILE_ENV_VALUE_BYTES = 32 << 10;
const PROFILE_DIR_TOKEN = "{{profileDir}}";
const reservedUids = new Set<number>();

type HookEvent = { name: string; matcher?: string };

/**
 * PostToolUse hook command for CoDev agent profiles. The token is piped to
 * curl as a header so it never appears in a process argument list. The hook
 * always exits 0 and prints only the host's reply, so an unreachable or slow
 * host leaves the agent untouched.
 */
export const COORDINATION_HOOK_COMMAND = [
	'[ -n "$SUPERSET_HOST_AGENT_HOOK_URL" ] && [ -n "$SUPERSET_TERMINAL_ID" ] && [ -n "$SUPERSET_ACCOUNT_ATTRIBUTION_TOKEN" ] &&',
	`printf 'x-codev-hook-token: %s\\n' "$SUPERSET_ACCOUNT_ATTRIBUTION_TOKEN" |`,
	"curl -sf --connect-timeout 0.2 --max-time 0.3 -H @- -H 'content-type: application/json'",
	'--data "{\\"agentId\\":\\"$SUPERSET_TERMINAL_ID\\"}"',
	`"\${SUPERSET_HOST_AGENT_HOOK_URL%/trpc/notifications.hook}/codev/coordination/notices";`,
	"exit 0",
].join(" ");

const CODEX_HOOK_EVENTS: HookEvent[] = [
	{ name: "SessionStart" },
	{ name: "SessionEnd" },
	{ name: "UserPromptSubmit" },
	{ name: "PreToolUse", matcher: "^request_user_input$" },
	{ name: "PostToolUse", matcher: "*" },
	{ name: "Stop" },
	{ name: "Interrupt" },
	{ name: "SubagentStart" },
	{ name: "SubagentStop" },
];
const CLAUDE_HOOK_EVENTS: HookEvent[] = [
	{ name: "SessionStart" },
	{ name: "SessionEnd" },
	{ name: "UserPromptSubmit" },
	{ name: "Stop" },
	{ name: "StopFailure" },
	{ name: "SubagentStart" },
	{ name: "SubagentStop" },
	{ name: "PostToolUse", matcher: "*" },
	{ name: "PostToolUseFailure", matcher: "*" },
	{ name: "PermissionRequest", matcher: "*" },
];

export type AgentLaunchProfile = {
	files?: Array<{ path: string; contents: string }>;
	env?: Record<string, string>;
};

export type AgentLaunch = {
	directory: string;
	uid: number;
	command: string;
	hookToken: string;
};

function quote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function agentLaunchScript(
	directory: string,
	command: string[],
	env: Record<string, string> = {},
): string {
	const lines = ["#!/bin/sh", "umask 0002"];
	for (const [name, value] of Object.entries(env).sort(([left], [right]) => left.localeCompare(right))) {
		lines.push(`export ${name}=${quote(value.replaceAll(PROFILE_DIR_TOKEN, directory))}`);
	}
	lines.push(command.map(quote).join(" "), "exit $?");
	return `${lines.join("\n")}\n`;
}

export function validateAgentLaunchProfile(profile: AgentLaunchProfile): void {
	const files = profile.files ?? [];
	if (files.length > MAX_PROFILE_FILES) throw new Error("Launch profile has too many files.");
	const paths = new Set<string>();
	for (const file of files) {
		if (
			!file.path ||
			file.path.includes("\\") ||
			file.path.startsWith("/") ||
			file.path.split("/").some((part) => !part || part === "." || part === "..")
		) {
			throw new Error("Launch profile file paths must be relative to the profile.");
		}
		if (!paths.add(file.path)) throw new Error("Launch profile contains a duplicate file path.");
		if (Buffer.byteLength(file.contents) > MAX_PROFILE_FILE_BYTES) {
			throw new Error(`Launch profile file ${file.path} is too large.`);
		}
	}
	const entries = Object.entries(profile.env ?? {});
	if (entries.length > MAX_PROFILE_ENV_VARS) throw new Error("Launch profile has too many environment variables.");
	for (const [name, value] of entries) {
		if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
			throw new Error("Launch profile environment names must use A-Z, 0-9, and _.");
		}
		if (Buffer.byteLength(value) > MAX_PROFILE_ENV_VALUE_BYTES) {
			throw new Error(`Launch profile value for ${name} is too large.`);
		}
	}
}

async function prepareProfileParents(directory: string, relativePath: string, uid: number) {
	let parent = directory;
	for (const part of relativePath.split("/").slice(0, -1)) {
		parent = join(parent, part);
		await mkdir(parent, { recursive: true, mode: 0o700 });
		await chmod(parent, 0o700);
		await chown(parent, uid, WORKSPACE_GID);
	}
}

async function allocateUid(root: string): Promise<number> {
	const used = new Set(reservedUids);
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith("agent-")) continue;
		used.add((await lstat(join(root, entry.name))).uid);
	}
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const uid = randomInt(MIN_AGENT_UID, MAX_AGENT_UID);
		if (used.has(uid) || reservedUids.has(uid)) continue;
		reservedUids.add(uid);
		return uid;
	}
	throw new Error("Could not allocate an isolated agent identity.");
}

/**
 * The root is provisioned by systemd: root-owned and searchable (0711), but
 * not listable or writable by a terminal. Each child is owned by one distinct
 * agent uid (0700), so uid 2000 and other agents cannot read its contents.
 */
export async function prepareAgentLaunch(input: {
	root: string;
	command: string[];
	profile?: AgentLaunchProfile;
	provider: "openai" | "anthropic";
	hookToken: string;
}): Promise<AgentLaunch> {
	const profile = buildCoDevAgentProfile(input.profile ?? {}, input.provider);
	validateAgentLaunchProfile(profile);
	const root = await lstat(input.root);
	if (
		!root.isDirectory() ||
		root.isSymbolicLink() ||
		root.uid !== 0 ||
		(root.mode & 0o777) !== 0o711
	) {
		throw new Error("The isolated agent profile root is not provisioned safely.");
	}
	const uid = await allocateUid(input.root);
	let directory: string | undefined;
	try {
		directory = await mkdtemp(join(input.root, "agent-"));
		await chmod(directory, 0o700);
		for (const file of profile.files ?? []) {
			const path = join(directory, file.path);
			await prepareProfileParents(directory, file.path, uid);
			await writeFile(path, file.contents, { mode: 0o600, flag: "wx" });
			await chown(path, uid, WORKSPACE_GID);
		}
		const scriptPath = join(directory, "launch.sh");
		await writeFile(scriptPath, agentLaunchScript(directory, input.command, {
			...profile.env,
			SUPERSET_ACCOUNT_ATTRIBUTION_TOKEN: input.hookToken,
		}), {
			mode: 0o600,
			flag: "wx",
		});
		await chown(scriptPath, uid, WORKSPACE_GID);
		await chown(directory, uid, WORKSPACE_GID);
		// This short source line avoids Superset's root-owned /tmp staging for
		// initialCommand strings longer than 512 bytes.
		return { directory, uid, command: `. ${quote(scriptPath)}`, hookToken: input.hookToken };
	} catch (error) {
		if (directory) await rm(directory, { recursive: true, force: true });
		reservedUids.delete(uid);
		throw error;
	}
}

/**
 * CoDev owns this file alongside the member credential. The CLI reads hooks
 * from the same private profile, so another guest user cannot replace them.
 */
export function buildCoDevAgentProfile(
	profile: AgentLaunchProfile,
	provider: "openai" | "anthropic",
): AgentLaunchProfile {
	if ((profile.files?.length ?? 0) >= MAX_PROFILE_FILES) {
		throw new Error("Launch profile must leave room for the CoDev hook configuration.");
	}
	const harness = provider === "openai" ? "codex" : "claude";
	const command = `[ -n "$SUPERSET_HOME_DIR" ] && [ -x "$SUPERSET_HOME_DIR/hooks/notify.sh" ] && SUPERSET_HOOK_HARNESS=${harness} "$SUPERSET_HOME_DIR/hooks/notify.sh" || true`;
	const events = provider === "openai" ? CODEX_HOOK_EVENTS : CLAUDE_HOOK_EVENTS;
	const hooks = Object.fromEntries(
		events.map(({ name, matcher }) => [
			name,
			[
				{
					...(matcher ? { matcher } : {}),
					hooks: [
						{ type: "command", command },
						...(name === "PostToolUse"
							? [{ type: "command", command: COORDINATION_HOOK_COMMAND }]
							: []),
					],
				},
			],
		]),
	);
	const path = provider === "openai" ? ".codex/hooks.json" : ".claude/settings.json";
	const contents = JSON.stringify({ hooks });
	return {
		...profile,
		files: [...(profile.files ?? []), { path, contents }],
		env: {
			...profile.env,
			...(provider === "anthropic"
				? { CLAUDE_CONFIG_DIR: `${PROFILE_DIR_TOKEN}/.claude` }
				: {}),
		},
	};
}

export async function removeAgentLaunch(launch: AgentLaunch | undefined): Promise<void> {
	if (!launch) return;
	await rm(launch.directory, { recursive: true, force: true });
	reservedUids.delete(launch.uid);
}
