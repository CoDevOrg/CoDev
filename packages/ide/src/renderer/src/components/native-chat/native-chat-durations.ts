import type { NativeChatMessage } from '../../../../shared/native-chat-types'

/**
 * How long each turn actually took, derived from message timestamps.
 *
 * Neither Claude nor Codex reports a duration per reasoning block or tool run,
 * but every transcript message carries the epoch ms it was produced at — so
 * the span from one message to the next is how long the agent spent on it.
 * That is the number a person watching wants: "it thought for 6s", "those
 * tools took 12s", rather than a spinner with no sense of cost.
 *
 * The final message is still in progress, so its span is measured against
 * `now` and ticks up live.
 */

/** Spans longer than this are a paused session or a clock jump, not work. */
const MAX_PLAUSIBLE_SPAN_MS = 30 * 60_000

/** Below this the label is noise — a sub-second step reads as instant. */
const MIN_REPORTABLE_MS = 900

export function nativeChatTurnDurations(
  messages: readonly NativeChatMessage[],
  now: number,
): Array<number | null> {
  return messages.map((message, index) => {
    if (message.timestamp === null) return null
    const next = messages[index + 1]
    // The last message is still being produced; measure it against the clock.
    const end = next ? next.timestamp : now
    if (end === null || end === undefined) return null
    const span = end - message.timestamp
    if (span < 0 || span > MAX_PLAUSIBLE_SPAN_MS) return null
    return span
  })
}

/**
 * How long each *turn* took: from the user's message to the last message the
 * agent produced before the next user message.
 *
 * Per-message spans alone are not enough. One assistant response is split into
 * separate tool and prose messages that carry the same transcript timestamp,
 * so the gap between them is zero and nothing is reportable — which is exactly
 * what happened on the first live turn. The turn span is the number a person
 * actually means by "how long did that take", and it survives any block
 * splitting.
 *
 * Returns a duration only on the final message of each turn; every other index
 * is null, so a caller can render it once per answer.
 */
export function nativeChatTurnTotals(
  messages: readonly NativeChatMessage[],
  now: number,
  /** The turn in flight has no closing message yet; measure it against `now`. */
  isWorking: boolean,
): Array<number | null> {
  const totals: Array<number | null> = messages.map(() => null)
  let turnStart: number | null = null
  let turnStartIndex = -1

  const close = (endIndex: number, end: number | null) => {
    if (turnStart === null || endIndex < 0 || end === null) return
    const span = end - turnStart
    if (span < 0 || span > MAX_PLAUSIBLE_SPAN_MS) return
    totals[endIndex] = span
  }

  messages.forEach((message, index) => {
    if (message.role === 'user') {
      // Close the previous turn on the message before this prompt.
      close(index - 1, messages[index - 1]?.timestamp ?? null)
      turnStart = message.timestamp
      turnStartIndex = index
      return
    }
    if (turnStartIndex < 0) return
  })

  // The trailing turn: still running (measure to now) or finished at its last
  // message.
  const lastIndex = messages.length - 1
  if (lastIndex >= 0 && messages[lastIndex]?.role !== 'user') {
    close(lastIndex, isWorking ? now : (messages[lastIndex]?.timestamp ?? null))
  }
  return totals
}

/** `6s` / `1m 04s`. Null when the span is too short to be worth reporting. */
export function formatTurnDuration(ms: number | null): string | null {
  if (ms === null || ms < MIN_REPORTABLE_MS) return null
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}
