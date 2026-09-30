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

export type AgentLaunchProfile = {
	files?: Array<{ path: string; contents: string }>;
	env?: Record<string, string>;
};

export type AgentLaunch = {
	directory: string;
	uid: number;
	command: string;
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
}): Promise<AgentLaunch> {
	const profile = input.profile ?? {};
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
		await writeFile(scriptPath, agentLaunchScript(directory, input.command, profile.env), {
			mode: 0o600,
			flag: "wx",
		});
		await chown(scriptPath, uid, WORKSPACE_GID);
		await chown(directory, uid, WORKSPACE_GID);
		// This short source line avoids Superset's root-owned /tmp staging for
		// initialCommand strings longer than 512 bytes.
		return { directory, uid, command: `. ${quote(scriptPath)}` };
	} catch (error) {
		if (directory) await rm(directory, { recursive: true, force: true });
		reservedUids.delete(uid);
		throw error;
	}
}

export async function removeAgentLaunch(launch: AgentLaunch | undefined): Promise<void> {
	if (!launch) return;
	await rm(launch.directory, { recursive: true, force: true });
	reservedUids.delete(launch.uid);
}
