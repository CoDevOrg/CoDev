import type { JSX } from 'react'

/**
 * The shapes and small renderers shared by CoDev's two team surfaces: the left
 * rail (who is here, which channels exist) and the center channel pane (one
 * conversation, full width).
 *
 * These lived inside `sidebar/CodevTeamPanel.tsx` while the channel view was a
 * takeover of that same rail. Moving the conversation to the center split the
 * two surfaces apart, so the vocabulary they both speak lives here rather than
 * being imported out of a sidebar component by a center pane.
 */

export const AGENT_MENTION = '@agent'
export const MESSAGE_GROUP_WINDOW_MS = 5 * 60_000

export type CollaborationUser = {
  id: string
  login: string
  name: string | null
  avatarUrl: string | null
}

export type TeamMemberPresence = {
  user: CollaborationUser
  accessRole: string
  isViewer: boolean
  online: boolean
  headline: string | null
  emoji: string | null
  activePath: string | null
  agentTask: string | null
  agentProvider: string | null
}

export type TeamRoster = {
  viewerId: string
  members: TeamMemberPresence[]
}

export type ChannelSummary = {
  id: string
  slug: string
  topic: string | null
  agentAccess: boolean
  unreadCount: number
  lastMessagePreview: string | null
  lastMessageAuthor: string | null
}

export type ChannelMessage = {
  id: string
  channelId: string
  authorKind: 'member' | 'agent' | 'system'
  author: CollaborationUser | null
  authorLabel: string | null
  body: string
  mentionsAgent: boolean
  createdAt: string
}

export type MessageGroup = {
  key: string
  authorKey: string
  authorKind: ChannelMessage['authorKind']
  authorName: string
  avatarUrl: string | null
  createdAt: string
  messages: ChannelMessage[]
}

export function displayName(member: { user: { login: string; name: string | null } }): string {
  return member.user.name?.trim() || member.user.login
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase()
  }
  return name.slice(0, 2).toUpperCase() || '?'
}

export function authorNameFor(message: ChannelMessage): string {
  if (message.author) {
    return message.author.name?.trim() || message.author.login
  }
  return message.authorLabel?.trim() || (message.authorKind === 'agent' ? 'Agent' : 'CoDev')
}

export function groupMessages(messages: ChannelMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  for (const message of messages) {
    const authorKey = `${message.authorKind}:${message.author?.id ?? message.authorLabel ?? 'system'}`
    const previous = groups.at(-1)
    const withinWindow =
      previous &&
      previous.authorKey === authorKey &&
      Date.parse(message.createdAt) - Date.parse(previous.messages.at(-1)!.createdAt) <
        MESSAGE_GROUP_WINDOW_MS
    if (withinWindow) {
      previous.messages.push(message)
      continue
    }
    groups.push({
      key: message.id,
      authorKey,
      authorKind: message.authorKind,
      authorName: authorNameFor(message),
      avatarUrl: message.author?.avatarUrl ?? null,
      createdAt: message.createdAt,
      messages: [message]
    })
  }
  return groups
}

export function formatChatTime(iso: string, now = Date.now()): string {
  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) {
    return ''
  }
  const seconds = Math.max(0, Math.round((now - timestamp) / 1_000))
  if (seconds < 45) {
    return 'now'
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours}h`
  }
  const days = Math.round(hours / 24)
  if (days < 7) {
    return `${days}d`
  }
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Members whose access role can open new channels; matches server enforcement. */
export function canCreateChannelFor(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'co_steer'
}

export function MemberAvatar({
  name,
  avatarUrl,
  online,
  size = 24
}: {
  name: string
  avatarUrl: string | null
  online: boolean
  size?: number
}): JSX.Element {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-worktree-sidebar-foreground/10 text-[10px] font-semibold text-worktree-sidebar-foreground/80"
      style={{ width: size, height: size }}
      title={name}
    >
      {avatarUrl ? (
        <img alt="" src={avatarUrl} className="h-full w-full object-cover" />
      ) : (
        initialsFor(name)
      )}
      {online ? (
        <span className="absolute -bottom-px -right-px size-2 rounded-full border border-worktree-sidebar bg-emerald-500" />
      ) : null}
    </span>
  )
}
