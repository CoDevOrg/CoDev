import type { Gen2TurnState } from "@codev/contracts";

import {
  CLAUDE_STREAM_EVENT_TYPES,
  reduceClaudeTurn,
} from "./claude-turn-events";
import { reduceCodexTurn } from "./turn-events";

/**
 * The reducer for whichever agent wrote `output`.
 *
 * The stream says which it is: Claude's events (`system`, `assistant`,
 * `result`, …) share no type with Codex's (`thread.*`, `turn.*`, `item.*`).
 * Reading it back from the text means the browser, which re-reduces the whole
 * accumulated stream on every poll, and the server, which does the same when a
 * turn exits, need no provider threaded to them and no column to remember it.
 */
export function reduceGen2Turn(output: string): Gen2TurnState {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const type = (JSON.parse(trimmed) as { type?: unknown }).type;
      if (typeof type !== "string") continue;
      if (CLAUDE_STREAM_EVENT_TYPES.has(type)) return reduceClaudeTurn(output);
      if (/^(thread|turn|item)\.|^error$/.test(type)) {
        return reduceCodexTurn(output);
      }
    } catch {
      /* PTY noise, or a partial line. */
    }
  }
  return reduceCodexTurn(output);
}
