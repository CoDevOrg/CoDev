import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type JSX
} from 'react'
import { Check, Hash, Lock, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { requestCodevBridge } from '@/web/codev-bridge-singleton'
import { openCodevChannel, useCodevChannelId } from '@/web/codev-channel-view'
import {
  canCreateChannelFor,
  displayName,
  MemberAvatar,
  type ChannelSummary,
  type TeamMemberPresence,
  type TeamRoster
} from '@/components/codev/codev-team-shared'

/**
 * CoDev team rail, folded into Orca's left sidebar.
 *
 * A CoDev workspace is several people steering several agents against one
 * repository. This panel is who is here, what each person is on, and the
 * workspace's chat channels. It sits in the lower half of the sidebar, under
 * the list of chats in this worktree.
 *
 * Clicking a channel no longer takes over this rail: it opens the conversation
 * in the center of the workspace (`components/codev/CodevChannelPane`), where
 * a conversation between people gets the same room as a conversation with an
 * agent. The rail keeps showing the roster and marks the open channel.
 *
 * Data comes over the workspace-bound `codev-bridge`: the parent CoDev page
 * owns the workspace id and proxies each call to `/api/workspaces/:id/...`.
 */

const AGENT_MENTION = '@agent'
const ROSTER_POLL_MS = 5_000
const STATUS_EMOJI = ['\u{1F6E0}\uFE0F', '\u{1F50D}', '\u{1F41B}', '\u{1F4DD}', '\u{1F680}', '\u2615']

function isEmbedded(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
}

function describeMemberFocus(member: TeamMemberPresence): {
  text: string
  kind: 'headline' | 'agent' | 'file' | 'idle'
} {
  if (member.headline?.trim()) {
    return { text: member.headline.trim(), kind: 'headline' }
  }
  if (member.agentTask?.trim()) {
    return { text: member.agentTask.trim(), kind: 'agent' }
  }
  if (member.activePath) {
    return { text: member.activePath, kind: 'file' }
  }
  return { text: member.online ? 'In the workspace' : 'Away', kind: 'idle' }
}

function StatusComposer({
  member,
  onSave
}: {
  member: TeamMemberPresence
  onSave: (headline: string | null, emoji: string | null) => Promise<void>
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [headline, setHeadline] = useState(member.headline ?? '')
  const [emoji, setEmoji] = useState(member.emoji ?? '')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSaving(true)
    try {
      await onSave(headline.trim() || null, emoji || null)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setHeadline(member.headline ?? '')
          setEmoji(member.emoji ?? '')
          setEditing(true)
        }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-worktree-sidebar-foreground/8"
      >
        <MemberAvatar
          avatarUrl={member.user.avatarUrl}
          name={displayName(member)}
          online={member.online}
          size={26}
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-semibold text-worktree-sidebar-foreground/90">
            {displayName(member)}
          </span>
          <span className="truncate text-[11px] text-worktree-sidebar-foreground/50">
            {member.headline
              ? `${member.emoji ? `${member.emoji} ` : ''}${member.headline}`
              : 'What are you working on?'}
          </span>
        </span>
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5 px-2 py-1.5">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Status emoji">
        {STATUS_EMOJI.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={emoji === option}
            onClick={() => setEmoji(emoji === option ? '' : option)}
            className={cn(
              'flex size-6 items-center justify-center rounded text-xs',
              emoji === option
                ? 'bg-worktree-sidebar-accent'
                : 'hover:bg-worktree-sidebar-foreground/10'
            )}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <input
          aria-label="Your status"
          autoFocus
          maxLength={120}
          value={headline}
          onChange={(event) => setHeadline(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setEditing(false)
            }
          }}
          placeholder="Reviewing the auth refactor"
          className="min-w-0 flex-1 rounded border border-worktree-sidebar-border/70 bg-worktree-sidebar-foreground/5 px-2 py-1 text-[12px] text-worktree-sidebar-foreground/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-worktree-sidebar-ring/50"
        />
        <button
          type="submit"
          aria-label="Save status"
          disabled={saving}
          className="flex size-6 shrink-0 items-center justify-center rounded bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground disabled:opacity-50"
        >
          <Check aria-hidden className="size-3.5" />
        </button>
      </div>
    </form>
  )
}

function useCodevTeam(active: boolean): {
  roster: TeamRoster | null
  channels: ChannelSummary[]
  error: string | null
  markChannelRead: (id: string) => void
  refresh: () => Promise<void>
} {
  const [roster, setRoster] = useState<TeamRoster | null>(null)
  const [channels, setChannels] = useState<ChannelSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [nextRoster, channelPayload] = await Promise.all([
        requestCodevBridge<TeamRoster>('team.roster'),
        requestCodevBridge<{ channels?: ChannelSummary[] }>('team.channels')
      ])
      setRoster(nextRoster)
      setChannels(channelPayload.channels ?? [])
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Team chat is offline.')
    }
  }, [])

  useEffect(() => {
    if (!active) {
      return
    }
    let cancelled = false
    const tick = (): void => {
      if (!cancelled) {
        void refresh()
      }
    }
    tick()
    const timer = setInterval(tick, ROSTER_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [active, refresh])

  // Opening a channel clears its badge here immediately; the next roster poll
  // confirms it from the server rather than leaving a stale count on screen.
  const markChannelRead = useCallback((id: string) => {
    setChannels((current) =>
      current.map((channel) => (channel.id === id ? { ...channel, unreadCount: 0 } : channel))
    )
  }, [])

  return { roster, channels, error, markChannelRead, refresh }
}

export function CodevTeamPanel(): JSX.Element | null {
  const active = isEmbedded()
  const { roster, channels, error, markChannelRead, refresh } = useCodevTeam(active)
  const openChannelId = useCodevChannelId()
  const [notice, setNotice] = useState<string | null>(null)
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [newChannelSlug, setNewChannelSlug] = useState('')
  const [newChannelError, setNewChannelError] = useState<string | null>(null)

  if (!active) {
    return null
  }

  const viewer = roster?.members.find((member) => member.isViewer) ?? null
  const teammates = roster?.members.filter((member) => !member.isViewer) ?? []
  const onlineCount = roster?.members.filter((member) => member.online).length ?? 0
  const canCreateChannel = canCreateChannelFor(viewer?.accessRole)

  const handleOpenChannel = (id: string): void => {
    setNotice(null)
    markChannelRead(id)
    openCodevChannel(id)
  }

  const handleCreateChannel = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const slug = newChannelSlug
      .trim()
      .replace(/^#/, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      setNewChannelError('Use lowercase letters, numbers and hyphens.')
      return
    }
    try {
      const created = await requestCodevBridge<{ channel: { id: string } }>('team.createChannel', {
        slug
      })
      setNewChannelSlug('')
      setNewChannelError(null)
      setNewChannelOpen(false)
      await refresh()
      handleOpenChannel(created.channel.id)
    } catch (cause) {
      setNewChannelError(cause instanceof Error ? cause.message : 'The channel was not created.')
    }
  }

  const handleSaveStatus = async (
    headline: string | null,
    emoji: string | null
  ): Promise<void> => {
    await requestCodevBridge('team.saveStatus', { headline, emoji })
    await refresh()
  }

  return (
    <div className="flex h-1/2 min-h-0 shrink-0 flex-col border-t border-worktree-sidebar-border/60 bg-worktree-sidebar">
      <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
        <div className="flex items-center gap-1.5 px-3 pb-1 pt-1.5">
          <Users aria-hidden className="size-3 text-worktree-sidebar-foreground/40" />
          <span className="text-xs font-semibold text-worktree-sidebar-foreground/80">Team</span>
          <span className="text-[11px] text-worktree-sidebar-foreground/45">
            {onlineCount} here
          </span>
        </div>

        {error ? (
          <p className="px-3 py-1 text-[11px] text-worktree-sidebar-foreground/45">{error}</p>
        ) : null}
        {notice ? (
          <p className="px-3 py-1 text-[11px] text-worktree-sidebar-foreground/55">{notice}</p>
        ) : null}

        {viewer ? <StatusComposer member={viewer} onSave={handleSaveStatus} /> : null}

        <ul className="px-1">
          {teammates.map((member) => {
            const focus = describeMemberFocus(member)
            return (
              <li key={member.user.id} className="flex items-center gap-2 rounded-md px-2 py-1">
                <MemberAvatar
                  avatarUrl={member.user.avatarUrl}
                  name={displayName(member)}
                  online={member.online}
                />
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1 truncate text-[12px] font-medium text-worktree-sidebar-foreground/85">
                    {displayName(member)}
                    <em className="not-italic text-[10px] text-worktree-sidebar-foreground/40">
                      {member.accessRole.replace('_', ' ')}
                    </em>
                  </span>
                  <span
                    className={cn(
                      'truncate text-[11px]',
                      focus.kind === 'idle'
                        ? 'text-worktree-sidebar-foreground/40'
                        : 'text-worktree-sidebar-foreground/55'
                    )}
                  >
                    {member.emoji && focus.kind === 'headline' ? `${member.emoji} ` : ''}
                    {focus.text}
                  </span>
                </div>
              </li>
            )
          })}
          {teammates.length === 0 ? (
            <li className="px-2 py-1 text-[11px] text-worktree-sidebar-foreground/40">
              You are the only member. Use Share to invite your team.
            </li>
          ) : null}
        </ul>

        <div className="mt-1 flex items-center justify-between px-3 pb-0.5 pt-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-worktree-sidebar-foreground/40">
            Channels
          </span>
        </div>
        <ul className="px-1">
          {channels.map((channel) => (
            <li key={channel.id}>
              <button
                type="button"
                aria-current={channel.id === openChannelId ? 'true' : undefined}
                onClick={() => handleOpenChannel(channel.id)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-worktree-sidebar-foreground/8',
                  channel.id === openChannelId && 'bg-worktree-sidebar-accent/70'
                )}
              >
                <Hash
                  aria-hidden
                  className="size-3 shrink-0 text-worktree-sidebar-foreground/40"
                />
                <span className="truncate text-[12px] text-worktree-sidebar-foreground/80">
                  {channel.slug}
                </span>
                {!channel.agentAccess ? (
                  <Lock
                    aria-hidden
                    className="size-2.5 shrink-0 text-worktree-sidebar-foreground/35"
                  />
                ) : null}
                {channel.unreadCount > 0 ? (
                  <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-px text-[9px] font-semibold text-primary-foreground">
                    {channel.unreadCount}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          {channels.length === 0 ? (
            <li className="px-2 py-1 text-[11px] text-worktree-sidebar-foreground/40">
              No channels yet.
            </li>
          ) : null}
        </ul>

        {canCreateChannel ? (
          newChannelOpen ? (
            <form onSubmit={handleCreateChannel} className="flex flex-col gap-1 px-3 py-1.5">
              <div className="flex items-center gap-1">
                <span aria-hidden className="text-[12px] text-worktree-sidebar-foreground/40">
                  #
                </span>
                <input
                  aria-label="New channel name"
                  autoFocus
                  maxLength={48}
                  value={newChannelSlug}
                  onChange={(event) => setNewChannelSlug(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setNewChannelOpen(false)
                    }
                  }}
                  placeholder="deploys"
                  className="min-w-0 flex-1 rounded border border-worktree-sidebar-border/70 bg-worktree-sidebar-foreground/5 px-2 py-1 text-[12px] text-worktree-sidebar-foreground/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-worktree-sidebar-ring/50"
                />
                <button
                  type="submit"
                  className="rounded bg-worktree-sidebar-accent px-2 py-1 text-[11px] text-worktree-sidebar-accent-foreground"
                >
                  Create
                </button>
              </div>
              {newChannelError ? (
                <p className="text-[11px] text-destructive">{newChannelError}</p>
              ) : null}
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setNewChannelOpen(true)}
              className="mx-3 my-1 rounded px-2 py-1 text-left text-[11px] text-worktree-sidebar-foreground/55 hover:bg-worktree-sidebar-foreground/8"
            >
              + New channel
            </button>
          )
        ) : null}

        <p className="px-3 py-1 text-[10px] leading-snug text-worktree-sidebar-foreground/35">
          Mention <code className="text-worktree-sidebar-foreground/50">{AGENT_MENTION}</code> in a
          channel to bring the coding agent into the conversation.
        </p>
      </div>
    </div>
  )
}

export default CodevTeamPanel
