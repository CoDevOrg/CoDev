import "server-only";

import { formatGen2WorkspaceAgentPrompt } from "./workspace-agent-instructions";

/**
 * The Claude counterpart of `buildGen2CodexCommand`, delivered the same two
 * ways (direct sandbox exec and the Superset terminal agent).
 *
 * `--output-format stream-json` needs `--verbose` under `-p`. Partial-message
 * events are deliberately left off: `claude-turn-events.ts` renders whole
 * assistant messages, which is what keeps its items idempotent across the
 * re-reduced stream. The credential is never an argument — it arrives as
 * `CLAUDE_CODE_OAUTH_TOKEN` in the launch profile's environment.
 */
export function buildGen2ClaudeCommand(
  prompt: string,
  history: Array<{ role: "user" | "assistant"; body: string }> = [],
  model?: string,
) {
  return [
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
    ...(model?.trim() ? ["--model", model.trim()] : []),
    formatGen2WorkspaceAgentPrompt(prompt, history),
  ];
}
