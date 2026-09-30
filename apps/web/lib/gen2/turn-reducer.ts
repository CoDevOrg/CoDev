import type { Gen2AgentProviderName, Gen2TurnState } from "@codev/contracts";

import {
  CLAUDE_STREAM_EVENT_TYPES,
  reduceClaudeTurn,
} from "./claude-turn-events";
import { reduceCodexTurn } from "./turn-events";

/**
 * How each provider's output is recognised and reduced.
 *
 * `Record` keyed by provider id: adding an agent to `GEN2_AGENT_PROVIDERS`
 * does not compile until it says here how to tell its stream apart and how to
 * turn it into cards. `recognises` takes an event's `type`, so two providers
 * must not share one.
 */
const READERS: Record<
  Gen2AgentProviderName,
  {
    recognises: (eventType: string) => boolean;
    reduce: (output: string) => Gen2TurnState;
  }
> = {
  codex: {
    recognises: (type) => /^(thread|turn|item)\.|^error$/.test(type),
    reduce: reduceCodexTurn,
  },
  claude: {
    recognises: (type) => CLAUDE_STREAM_EVENT_TYPES.has(type),
    reduce: reduceClaudeTurn,
  },
};

const NOTHING_YET: Gen2TurnState = {
  items: [],
  reply: "",
  error: null,
  usage: null,
  status: "running",
};

/**
 * The reduction of whichever agent wrote `output`.
 *
 * The stream says which it is, so the browser (which re-reduces the whole
 * accumulated stream on every poll) and the server (which does the same when a
 * turn exits) need no provider threaded to them and no column to remember it.
 * Until an event any reader recognises arrives, the turn is simply running;
 * an unrecognised stream is never guessed to be some provider's.
 */
export function reduceGen2Turn(output: string): Gen2TurnState {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const type = (JSON.parse(trimmed) as { type?: unknown }).type;
      if (typeof type !== "string") continue;
      for (const reader of Object.values(READERS)) {
        if (reader.recognises(type)) return reader.reduce(output);
      }
    } catch {
      /* PTY noise, or a partial line. */
    }
  }
  return NOTHING_YET;
}
