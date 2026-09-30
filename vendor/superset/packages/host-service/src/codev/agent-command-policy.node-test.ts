import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isApprovedAgentCommand } from "./agent-command-policy.ts";

const codex = [
	"codex", "exec", "--json", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check",
	"--sandbox", "danger-full-access", "-c", 'approval_policy="never"', "--model", "gpt-5", "--cd", ".", "prompt",
];
const claude = [
	"claude", "-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
	"--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
	"--permission-mode", "bypassPermissions", "--model", "sonnet", "prompt",
];

test("only accepts the approved Codex and Claude launch shapes", () => {
	assert.equal(isApprovedAgentCommand("openai", codex), true);
	assert.equal(isApprovedAgentCommand("anthropic", claude), true);
	assert.equal(isApprovedAgentCommand("openai", ["/bin/sh", "-c", "id"]), false);
	assert.equal(isApprovedAgentCommand("anthropic", [...claude, "--dangerous-flag"]), false);
	assert.equal(isApprovedAgentCommand("openai", [...codex.slice(0, 8), "read-only", ...codex.slice(9)]), false);
});
