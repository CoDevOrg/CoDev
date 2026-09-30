import { randomInt } from "node:crypto";
import { chown, chmod, lstat, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Reserved for CoDev agent processes. Ordinary terminals always use uid 2000.
const MIN_AGENT_UID = 100_000;
const MAX_AGENT_UID = 2_147_483_647;
const WORKSPACE_GID = 2000;
const reservedUids = new Set<number>();

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
	authCacheJson?: string,
): string {
	const lines = ["#!/bin/sh", "umask 0002"];
	if (authCacheJson) lines.push(`export CODEX_HOME=${quote(directory)}`);
	lines.push(command.map(quote).join(" "), "exit $?");
	return `${lines.join("\n")}\n`;
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
	authCacheJson?: string;
}): Promise<AgentLaunch> {
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
		if (input.authCacheJson) {
			const authPath = join(directory, "auth.json");
			await writeFile(authPath, input.authCacheJson, { mode: 0o600, flag: "wx" });
			await chown(authPath, uid, WORKSPACE_GID);
		}
		const scriptPath = join(directory, "launch.sh");
		await writeFile(scriptPath, agentLaunchScript(directory, input.command, input.authCacheJson), {
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
