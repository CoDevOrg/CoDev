import "server-only";

import type { Gen2AgentProviderName } from "@codev/contracts";

import { buildGen2ClaudeCommand } from "./claude-command";
import { buildGen2CodexCommand } from "./codex-command";

type History = Array<{ role: "user" | "assistant"; body: string }>;

/**
 * One builder per provider, keyed by id. `Record` makes the compiler refuse
 * a new entry in `GEN2_AGENT_PROVIDERS` until it has a command here (and a
 * reducer in `turn-reducer.ts`), instead of silently running as Codex.
 */
const COMMAND_BUILDERS: Record<
  Gen2AgentProviderName,
  (prompt: string, history: History) => string[]
> = {
  codex: buildGen2CodexCommand,
  claude: buildGen2ClaudeCommand,
};

export function buildGen2AgentCommand(
  provider: Gen2AgentProviderName,
  prompt: string,
  history: History = [],
) {
  return COMMAND_BUILDERS[provider](prompt, history);
}
