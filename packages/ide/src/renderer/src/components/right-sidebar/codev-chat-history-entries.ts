import type { AiVaultSession } from '../../../../shared/ai-vault-types'

/**
 * Rows for CoDev's chat history list.
 *
 * The embedded workspace hides Orca's Agent Session History tab and shows a
 * single Agents tab instead, which until now listed only what was running
 * right now. A member whose thread had grown too long to steer had nowhere to
 * go: the chat they wanted back was on disk, resumable, and invisible.
 *
 * This projects already-scanned vault sessions into that list. It is a pure
 * function so the ordering and de-duplication rules are testable without a
 * scanner, a runtime, or a rendered panel.
 */
export type CodevChatHistoryEntry = {
  id: string
  title: string
  agent: string
  branch: string | null
  messageCount: number
  modifiedAt: string
  isLive: boolean
}

export type CodevChatHistoryLiveSession = {
  /** Vault session id of a conversation that is currently attached to a pane. */
  sessionId: string | null
}

function timestamp(value: string): number {
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

export function buildCodevChatHistoryEntries(
  sessions: readonly AiVaultSession[],
  liveSessions: readonly CodevChatHistoryLiveSession[] = [],
  limit = 40
): CodevChatHistoryEntry[] {
  const live = new Set(
    liveSessions
      .map((session) => session.sessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId))
  )
  const seen = new Set<string>()
  const entries: CodevChatHistoryEntry[] = []

  for (const session of [...sessions].sort(
    (left, right) => timestamp(right.modifiedAt) - timestamp(left.modifiedAt)
  )) {
    // One transcript can be scanned from more than one path (a worktree and
    // the prior worktree it was moved from); the newest read wins.
    if (seen.has(session.sessionId)) {continue}
    seen.add(session.sessionId)
    entries.push({
      id: session.id,
      title: session.title?.trim() || 'Untitled chat',
      agent: session.agent,
      branch: session.branch,
      messageCount: session.messageCount,
      modifiedAt: session.modifiedAt,
      isLive: live.has(session.sessionId)
    })
    if (entries.length >= limit) {break}
  }

  return entries
}

export function formatChatHistoryAge(modifiedAt: string, now = Date.now()): string {
  const elapsed = now - timestamp(modifiedAt)
  if (!Number.isFinite(elapsed) || elapsed < 0) {return 'just now'}
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) {return 'just now'}
  if (minutes < 60) {return `${minutes}m ago`}
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {return `${hours}h ago`}
  const days = Math.floor(hours / 24)
  if (days < 30) {return `${days}d ago`}
  return `${Math.floor(days / 30)}mo ago`
}
