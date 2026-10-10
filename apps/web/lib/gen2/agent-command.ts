import "server-only";

import type { Gen2AgentProviderName } from "@codev/contracts";

import { buildGen2CursorCommand } from "./cursor-command";
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
  (
    prompt: string,
    history: History,
    model?: string,
    context?: string | undefined,
  ) => string[]
> = {
  codex: buildGen2CodexCommand,
  claude: buildGen2ClaudeCommand,
  cursor: buildGen2CursorCommand,
};

export function buildGen2AgentCommand(
  provider: Gen2AgentProviderName,
  prompt: string,
  history: History = [],
  model?: string,
  /** Turn context blocks (`agent-turn-context.ts`); the prompt stays last. */
  context?: string | undefined,
) {
  return COMMAND_BUILDERS[provider](prompt, history, model, context);
}
