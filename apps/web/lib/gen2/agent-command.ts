import "server-only";

import { buildGen2ClaudeCommand } from "./claude-command";
import { buildGen2CodexCommand } from "./codex-command";
import type { Gen2AgentProvider } from "./providers";

type History = Array<{ role: "user" | "assistant"; body: string }>;

/** The invocation for the provider a turn was asked to run. */
export function buildGen2AgentCommand(
  provider: Gen2AgentProvider,
  prompt: string,
  history: History = [],
) {
  return provider === "claude"
    ? buildGen2ClaudeCommand(prompt, history)
    : buildGen2CodexCommand(prompt, history);
}
