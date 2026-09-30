export type CoDevAgentProvider = "openai" | "anthropic";

const codexPrefix = [
	"codex",
	"exec",
	"--json",
	"--ephemeral",
	"--ignore-user-config",
	"--skip-git-repo-check",
	"--sandbox",
	"danger-full-access",
	"-c",
	'approval_policy="never"',
];

const claudePrefix = [
	"claude",
	"-p",
	"--output-format",
	"stream-json",
	"--verbose",
	"--no-session-persistence",
	"--setting-sources",
	"",
	"--strict-mcp-config",
	"--mcp-config",
	'{"mcpServers":{}}',
	"--permission-mode",
	"bypassPermissions",
];

function matchesPrefix(command: string[], prefix: string[]) {
	return prefix.every((value, index) => command[index] === value);
}

/**
 * The bridge receives a process launch request, so shell quoting alone is not
 * sufficient. Only the exact command shapes built by Gen 2 are accepted; the
 * model and prompt remain dynamic values at the tail of each invocation.
 */
export function isApprovedAgentCommand(provider: CoDevAgentProvider, command: string[]) {
	if (provider === "openai") {
		return (
			command.length === codexPrefix.length + 5 &&
			matchesPrefix(command, codexPrefix) &&
			command[10] === "--model" &&
			command[11]!.length > 0 &&
			command[12] === "--cd" &&
			command[13] === "." &&
			command[14]!.length > 0
		);
	}
	return (
		command.length === claudePrefix.length + 3 &&
		matchesPrefix(command, claudePrefix) &&
		command[13] === "--model" &&
		command[14]!.length > 0 &&
		command[15]!.length > 0
	);
}
