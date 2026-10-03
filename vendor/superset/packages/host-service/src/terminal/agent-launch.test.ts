import { describe, expect, it } from "bun:test";
import { agentTerminalLaunchOptions } from "./agent-launch";

const shared = {
	terminalId: "terminal-1",
	workspaceId: "workspace-1",
	db: {} as never,
	eventBus: {} as never,
	initialCommand: "agent --prompt 'hello'",
};

describe("agentTerminalLaunchOptions", () => {
	it("preserves native agent terminal defaults", () => {
		expect(agentTerminalLaunchOptions(shared)).toEqual(shared);
	});

	it("runs a CoDev agent with only its private profile", () => {
		expect(
			agentTerminalLaunchOptions({
				...shared,
				privateProfile: { directory: "/private/agent-1", uid: 2301 },
			}),
		).toMatchObject({
			includeDefaultAccountEnv: false,
			homeDirectory: "/private/agent-1",
			shell: "/usr/bin/setpriv",
			shellArgs: [
				"--reuid=2301",
				"--regid=2000",
				"--clear-groups",
				"--",
				"/bin/sh",
				"-l",
			],
			rows: 1_000,
			cols: 4_096,
		});
	});
});
