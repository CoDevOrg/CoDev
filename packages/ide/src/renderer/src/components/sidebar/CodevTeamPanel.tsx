import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
  type KeyboardEvent
} from 'react'
import { Check, Hash, Lock, Send, Sparkles, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { requestCodevBridge } from '@/web/codev-bridge-singleton'

/**
 * CoDev team rail, folded into Orca's left sidebar.
 *
 * A CoDev workspace is several people steering several agents against one
 * repository. This panel — who is here, what each person is on, and the
 * workspace's chat channels — used to live in a separate first-party rail to
 * the left of the IDE iframe. It now renders as a section of Orca's own
 * sidebar, below the worktree list, so the workspace has a single left
 * sidebar.
 *
 * Data comes over the workspace-bound `codev-bridge`: the parent CoDev page
 * owns the workspace id and proxies each call to `/api/workspaces/:id/...`.
 */

const AGENT_MENTION = '@agent'
const ROSTER_POLL_MS = 5_000
const MESSAGE_POLL_MS = 3_000
const STATUS_EMOJI = ['🛠️', '🔍', '🐛', '📝', '🚀', '☕']
const MESSAGE_GROUP_WINDOW_MS = 5 * 60_000

type CollaborationUser = {
  id: string
  login: string
  name: string | null
  avatarUrl: string | null
}

type TeamMemberPresence = {
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

type TeamRoster = {
  viewerId: string
  members: TeamMemberPresence[]
}

type ChannelSummary = {
  id: string
  slug: string
  topic: string | null
  agentAccess: boolean
  unreadCount: number
  lastMessagePreview: string | null
  lastMessageAuthor: string | null
}

type ChannelMessage = {
  id: string
  channelId: string
  authorKind: 'member' | 'agent' | 'system'
  author: CollaborationUser | null
  authorLabel: string | null
  body: string
  mentionsAgent: boolean
  createdAt: string
}

type MessageGroup = {
  key: string
  authorKey: string
  authorKind: ChannelMessage['authorKind']
  authorName: string
  avatarUrl: string | null
  createdAt: string
  messages: ChannelMessage[]
}

function isEmbedded(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
}

function displayName(member: { user: { login: string; name: string | null } }): string {
  return member.user.name?.trim() || member.user.login
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase()
  }
  return name.slice(0, 2).toUpperCase() || '?'
}

/** Members whose access role can open new channels; matches server enforcement. */
function canCreateChannelFor(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'co_steer'
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

function authorNameFor(message: ChannelMessage): string {
  if (message.author) {
    return message.author.name?.trim() || message.author.login
  }
  return (
    message.authorLabel?.trim() || (message.authorKind === 'agent' ? 'Agent' : 'CoDev')
  )
}

function groupMessages(messages: ChannelMessage[]): MessageGroup[] {
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

function formatChatTime(iso: string, now = Date.now()): string {
  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) return ''
  const seconds = Math.max(0, Math.round((now - timestamp) / 1_000))
  if (seconds < 45) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function MemberAvatar({
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
            if (event.key === 'Escape') setEditing(false)
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
  messages: ChannelMessage[]
  activeChannelId: string | null
  error: string | null
  openChannel: (id: string | null) => void
  setMessages: (updater: (current: ChannelMessage[]) => ChannelMessage[]) => void
  refresh: () => Promise<void>
} {
  const [roster, setRoster] = useState<TeamRoster | null>(null)
  const [channels, setChannels] = useState<ChannelSummary[]>([])
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [messages, setMessagesState] = useState<ChannelMessage[]>([])
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
    if (!active) return
    let cancelled = false
    const tick = (): void => {
      if (!cancelled) void refresh()
    }
    tick()
    const timer = setInterval(tick, ROSTER_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [active, refresh])

  useEffect(() => {
    if (!active || !activeChannelId) return
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const payload = await requestCodevBridge<{ messages?: ChannelMessage[] }>(
          'team.messages',
          { channelId: activeChannelId }
        )
        if (!cancelled) setMessagesState(payload.messages ?? [])
      } catch {
        // Keep the transcript we have; the next tick may succeed.
      }
    }
    void load()
    const timer = setInterval(() => void load(), MESSAGE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [active, activeChannelId])

  const openChannel = useCallback((id: string | null) => {
    setActiveChannelId(id)
    if (!id) {
      setMessagesState([])
      return
    }
    setChannels((current) =>
      current.map((channel) =>
        channel.id === id ? { ...channel, unreadCount: 0 } : channel
      )
    )
  }, [])

  return {
    roster,
    channels,
    messages,
    activeChannelId,
    error,
    openChannel,
    setMessages: setMessagesState,
    refresh
  }
}

function ChannelConversation({
  channel,
  messages,
  notice,
  sending,
  onBack,
  onSend
}: {
  channel: ChannelSummary
  messages: ChannelMessage[]
  notice: string | null
  sending: boolean
  onBack: () => void
  onSend: (body: string) => Promise<void>
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const groups = useMemo(() => groupMessages(messages), [messages])

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [groups.length, messages.length])

  async function submit(): Promise<void> {
    const body = draft.trim()
    if (!body || sending) return
    setDraft('')
    await onSend(body)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
    if (event.key === 'Escape') onBack()
  }

  return (
    <section aria-label={`#${channel.slug}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={onBack}
          className="rounded px-1 text-[12px] text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/10"
          aria-label="Back to channels"
        >
          ‹
        </button>
        <span className="flex min-w-0 items-center gap-1 text-[13px] font-semibold text-worktree-sidebar-foreground/90">
          <Hash aria-hidden className="size-3" />
          <span className="truncate">{channel.slug}</span>
        </span>
      </header>
      {channel.topic ? (
        <p className="px-3 pb-1 text-[11px] text-worktree-sidebar-foreground/45">
          {channel.topic}
        </p>
      ) : null}

      <div
        ref={scrollRef}
        role="log"
        className="scrollbar-sleek min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2"
      >
        {groups.length === 0 ? (
          <p className="px-1 text-[11px] text-worktree-sidebar-foreground/45">
            This is the start of #{channel.slug}. Say hello, or mention{' '}
            <code className="rounded bg-worktree-sidebar-foreground/10 px-1">{AGENT_MENTION}</code>{' '}
            to pull in the coding agent.
          </p>
        ) : null}
        {groups.map((group) => (
          <article key={group.key} className="flex gap-2">
            {group.authorKind === 'member' ? (
              <MemberAvatar
                avatarUrl={group.avatarUrl}
                name={group.authorName}
                online={false}
                size={22}
              />
            ) : (
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground">
                <Sparkles aria-hidden className="size-3" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[11px] text-worktree-sidebar-foreground/50">
                <strong className="text-worktree-sidebar-foreground/80">
                  {group.authorName}
                </strong>
                {group.authorKind === 'agent' ? (
                  <span className="rounded bg-worktree-sidebar-foreground/10 px-1 text-[9px] uppercase">
                    agent
                  </span>
                ) : null}
                <time dateTime={group.createdAt}>{formatChatTime(group.createdAt)}</time>
              </p>
              {group.messages.map((message) => (
                <p
                  key={message.id}
                  className="whitespace-pre-wrap break-words text-[12px] text-worktree-sidebar-foreground/85"
                >
                  {message.body}
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>

      {notice ? (
        <p className="px-3 py-1 text-[11px] text-worktree-sidebar-foreground/55">{notice}</p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="flex flex-col gap-1 border-t border-worktree-sidebar-border/60 p-2"
      >
        <textarea
          aria-label={`Message #${channel.slug}`}
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Message #${channel.slug}`}
          className="w-full resize-none rounded border border-worktree-sidebar-border/70 bg-worktree-sidebar-foreground/5 px-2 py-1 text-[12px] text-worktree-sidebar-foreground/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-worktree-sidebar-ring/50"
        />
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() =>
              setDraft((current) =>
                current.includes(AGENT_MENTION)
                  ? current
                  : `${current}${current && !current.endsWith(' ') ? ' ' : ''}${AGENT_MENTION} `
              )
            }
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/10"
          >
            <Sparkles aria-hidden className="size-3" />
            Ask the agent
          </button>
          <button
            type="submit"
            aria-label="Send message"
            disabled={sending || draft.trim().length === 0}
            className="flex size-6 items-center justify-center rounded bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground disabled:opacity-40"
          >
            <Send aria-hidden className="size-3" />
          </button>
        </div>
      </form>
    </section>
  )
}

export function CodevTeamPanel(): JSX.Element | null {
  const active = isEmbedded()
  const {
    roster,
    channels,
    messages,
    activeChannelId,
    error,
    openChannel,
    setMessages,
    refresh
  } = useCodevTeam(active)
  const [sending, setSending] = useState(false)
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
  const activeChannel = channels.find((channel) => channel.id === activeChannelId) ?? null
  const canCreateChannel = canCreateChannelFor(viewer?.accessRole)

  const handleSend = async (body: string): Promise<void> => {
    if (!activeChannel) return
    setSending(true)
    setNotice(null)
    try {
      const payload = await requestCodevBridge<{
        message: ChannelMessage
        agentDispatch?: { dispatched: boolean; reason?: string } | null
      }>('team.send', { channelId: activeChannel.id, body })
      setMessages((current) => [...current, payload.message])
      if (payload.agentDispatch) {
        setNotice(
          payload.agentDispatch.dispatched
            ? 'Sent to the running agent — its reply will land in this channel.'
            : `The agent was not reached: ${payload.agentDispatch.reason ?? 'no active session'}`
        )
      }
      void refresh()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'The message was not sent.')
    } finally {
      setSending(false)
    }
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
      const created = await requestCodevBridge<{ channel: { id: string } }>(
        'team.createChannel',
        { slug }
      )
      setNewChannelSlug('')
      setNewChannelError(null)
      setNewChannelOpen(false)
      await refresh()
      openChannel(created.channel.id)
    } catch (cause) {
      setNewChannelError(
        cause instanceof Error ? cause.message : 'The channel was not created.'
      )
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
    <div className="flex min-h-0 flex-1 flex-col border-t border-worktree-sidebar-border/60 bg-worktree-sidebar">
      {activeChannel ? (
        <ChannelConversation
          channel={activeChannel}
          messages={messages}
          notice={notice}
          sending={sending}
          onBack={() => {
            setNotice(null)
            openChannel(null)
          }}
          onSend={handleSend}
        />
      ) : (
        <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
          <div className="flex items-center gap-1.5 px-3 pb-1 pt-1.5">
            <Users aria-hidden className="size-3 text-worktree-sidebar-foreground/40" />
            <span className="text-xs font-semibold text-worktree-sidebar-foreground/80">
              Team
            </span>
            <span className="text-[11px] text-worktree-sidebar-foreground/45">
              {onlineCount} here
            </span>
          </div>

          {error ? (
            <p className="px-3 py-1 text-[11px] text-worktree-sidebar-foreground/45">{error}</p>
          ) : null}

          {viewer ? <StatusComposer member={viewer} onSave={handleSaveStatus} /> : null}

          <ul className="px-1">
            {teammates.map((member) => {
              const focus = describeMemberFocus(member)
              return (
                <li
                  key={member.user.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1"
                >
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
                  onClick={() => openChannel(channel.id)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-worktree-sidebar-foreground/8"
                >
                  <Hash aria-hidden className="size-3 shrink-0 text-worktree-sidebar-foreground/40" />
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
                      if (event.key === 'Escape') setNewChannelOpen(false)
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
      )}
    </div>
  )
}

export default CodevTeamPanel
