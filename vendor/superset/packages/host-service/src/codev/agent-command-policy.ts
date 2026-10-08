export type CoDevAgentProvider = "openai" | "anthropic" | "cursor";

const codexPrefix = [
	"codex",
	"exec",
	"--json",
	"--ephemeral",
	"--ignore-user-config",
	"--dangerously-bypass-hook-trust",
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

const cursorPrefix = [
	"cursor-agent",
	"--print",
	"--output-format",
	"stream-json",
	"--force",
	"--trust",
	"--disable-project-configs",
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
			command[11] === "--model" &&
			command[12]!.length > 0 &&
			command[13] === "--cd" &&
			command[14] === "." &&
			command[15]!.length > 0
		);
	}
	if (provider === "cursor") {
		return (
			command.length === cursorPrefix.length + 3 &&
			matchesPrefix(command, cursorPrefix) &&
			command[7] === "--model" &&
			command[8]!.length > 0 &&
			command[9]!.length > 0
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
