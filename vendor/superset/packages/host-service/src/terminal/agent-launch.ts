import type { HostDb } from "../db";
import type { EventBus } from "../events";
import type { CreateTerminalSessionOptions } from "./terminal";

type PrivateAgentProfile = {
	directory: string;
	uid: number;
	hookToken: string;
};

type AgentTerminalLaunch = {
	terminalId: string;
	workspaceId: string;
	db: HostDb;
	eventBus?: EventBus;
	initialCommand: string;
	privateProfile?: PrivateAgentProfile;
};

/**
 * Build the terminal options shared by native and CoDev agent launches.
 * A CoDev profile always runs as its isolated UID and never inherits the
 * host's default provider account.
 */
export function agentTerminalLaunchOptions(
	input: AgentTerminalLaunch,
): CreateTerminalSessionOptions {
	const { privateProfile, ...shared } = input;
	if (!privateProfile) return shared;

	return {
		...shared,
		rows: 1_000,
		cols: 4_096,
		includeDefaultAccountEnv: false,
		homeDirectory: privateProfile.directory,
		codevHookToken: privateProfile.hookToken,
		shell: "/usr/bin/setpriv",
		shellArgs: [
			`--reuid=${privateProfile.uid}`,
			"--regid=2000",
			"--clear-groups",
			"--",
			"/bin/sh",
			"-l",
		],
	};
}
