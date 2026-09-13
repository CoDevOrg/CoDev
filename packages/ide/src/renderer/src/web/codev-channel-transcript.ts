/**
 * Transcript bookkeeping for a team channel.
 *
 * The pane polls the latest page and also appends what it sends, and both
 * used to be blind writes: a poll that raced a send could show the message
 * twice or briefly erase it, and nothing could reach messages older than the
 * first page. Everything here reconciles by durable message id and keeps the
 * transcript in time order, so a page, a poll and a send can arrive in any
 * order and land the same way.
 */
export type TranscriptMessage = { id: string; createdAt: string }

/** The server's default page; a full page means there may be more. */
export const CHANNEL_PAGE_SIZE = 60

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/** Union by id, newest copy of a message wins, oldest first. */
export function mergeChannelMessages<T extends TranscriptMessage>(
  existing: readonly T[],
  incoming: readonly T[]
): T[] {
  const byId = new Map<string, T>()
  for (const message of existing) {
    byId.set(message.id, message)
  }
  for (const message of incoming) {
    byId.set(message.id, message)
  }
  return [...byId.values()].sort(
    (left, right) =>
      timestamp(left.createdAt) - timestamp(right.createdAt) || left.id.localeCompare(right.id)
  )
}

/** The cursor for the page before the oldest loaded message, if any. */
export function olderPageCursor(messages: readonly TranscriptMessage[]): string | null {
  return messages[0]?.createdAt ?? null
}

/** A short page is the end of history; a full one may not be. */
export function pageMayHaveMore(page: readonly unknown[], pageSize = CHANNEL_PAGE_SIZE): boolean {
  return page.length >= pageSize
}

/** How many of `next` are messages the reader has not had on screen. */
export function countNewMessages(
  previous: readonly TranscriptMessage[],
  next: readonly TranscriptMessage[]
): number {
  const seen = new Set(previous.map((message) => message.id))
  return next.filter((message) => !seen.has(message.id)).length
}
