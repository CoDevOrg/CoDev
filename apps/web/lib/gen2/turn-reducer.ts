import {
  GEN2_AGENT_PROVIDERS,
  type Gen2AgentProviderName,
  type Gen2TurnState,
} from "@codev/contracts";

import { reduceCursorTurn } from "./cursor-turn-events";
import { reduceClaudeTurn } from "./claude-turn-events";
import { reduceCodexTurn } from "./turn-events";

/**
 * One output parser per provider, chosen by the provider a turn was started
 * with — never guessed from the bytes. `Record` keyed by provider id: adding
 * an agent to `GEN2_AGENT_PROVIDERS` does not compile until it names its
 * parser here (and its command in `agent-command.ts`).
 */
const REDUCERS: Record<
  Gen2AgentProviderName,
  (output: string) => Gen2TurnState
> = {
  codex: reduceCodexTurn,
  claude: reduceClaudeTurn,
  cursor: reduceCursorTurn,
};

export function reduceGen2Turn(
  provider: Gen2AgentProviderName,
  output: string,
): Gen2TurnState {
  return REDUCERS[provider](output);
}

function labelFor(provider: Gen2AgentProviderName) {
  return (
    GEN2_AGENT_PROVIDERS.find((entry) => entry.id === provider)?.label ??
    provider
  );
}

/**
 * The state of a turn whose process has exited.
 *
 * A parser reports `running` until it sees its provider's closing event. If
 * the process is gone and that never came, the output was not in the format
 * the parser reads (the CLI missing, an auth error printed as plain text, a
 * format change) and no further poll will fix it. That is a failure to say
 * so, not a turn to wait on. The caller logs the raw output; this message
 * deliberately carries none of it.
 */
export function finalizeGen2Turn(
  provider: Gen2AgentProviderName,
  state: Gen2TurnState,
  exitCode: number | null,
): Gen2TurnState {
  if (state.status !== "running") return state;
  return {
    ...state,
    status: "failed",
    error:
      state.error ??
      `${labelFor(provider)} exited${
        exitCode === null ? "" : ` (code ${exitCode})`
      } without a result.`,
  };
}

/** Everything a caller needs once a turn's process has exited. */
export function settleGen2Turn(
  provider: Gen2AgentProviderName,
  output: string,
  exitCode: number | null,
): { state: Gen2TurnState; unparsed: boolean } {
  const state = reduceGen2Turn(provider, output);
  return {
    state: finalizeGen2Turn(provider, state, exitCode),
    unparsed: state.status === "running",
  };
}
