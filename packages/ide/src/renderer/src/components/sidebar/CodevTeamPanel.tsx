import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react'
import { Hash, Lock, MessageSquareText, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { requestCodevBridge } from '@/web/codev-bridge-singleton'
import { openCodevChannel, useCodevChannelId } from '@/web/codev-channel-view'
import {
  canCreateChannelFor,
  type ChannelSummary,
  type TeamRoster
} from '@/components/codev/codev-team-shared'

const CHANNEL_POLL_MS = 15_000

function isEmbedded(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
}

function useCodevChannels(active: boolean) {
  const [roster, setRoster] = useState<TeamRoster | null>(null)
  const [channels, setChannels] = useState<ChannelSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const refreshChannels = useCallback(async () => {
    try {
      const payload = await requestCodevBridge<{ channels?: ChannelSummary[] }>('team.channels')
      setChannels(payload.channels ?? [])
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Team room is offline.')
    }
  }, [])

  useEffect(() => {
    if (!active) {
      return
    }
    void requestCodevBridge<TeamRoster>('team.roster')
      .then(setRoster)
      .catch(() => undefined)
  }, [active])

  useEffect(() => {
    if (!active) {
      return
    }
    let cancelled = false
    const tick = (): void => {
      if (!cancelled && document.visibilityState === 'visible') {
        void refreshChannels()
      }
    }
    tick()
    const timer = window.setInterval(tick, CHANNEL_POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [active, refreshChannels])

  const markRead = useCallback((id: string) => {
    setChannels((current) =>
      current.map((channel) => (channel.id === id ? { ...channel, unreadCount: 0 } : channel))
    )
  }, [])
  return { roster, channels, error, markRead, refreshChannels }
}

export function CodevTeamPanel(): JSX.Element | null {
  const active = isEmbedded()
  const { roster, channels, error, markRead, refreshChannels } = useCodevChannels(active)
  const openChannelId = useCodevChannelId()
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [newChannelSlug, setNewChannelSlug] = useState('')
  const [newChannelError, setNewChannelError] = useState<string | null>(null)
  const openChannel = useCallback(
    (id: string) => {
      markRead(id)
      openCodevChannel(id)
    },
    [markRead]
  )

  useEffect(() => {
    if (!active) {
      return
    }
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin || event.source !== window.parent) {
        return
      }
      if ((event.data as { type?: unknown } | null)?.type !== 'codev:open-team-room') {
        return
      }
      const channel = channels.find((item) => item.slug === 'general') ?? channels[0]
      if (channel) {
        openChannel(channel.id)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [active, channels, openChannel])

  if (!active) {
    return null
  }
  const viewer = roster?.members.find((member) => member.isViewer) ?? null
  const canCreateChannel = canCreateChannelFor(viewer?.accessRole)

  const createChannel = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const slug = newChannelSlug.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase()
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
      await refreshChannels()
      openChannel(created.channel.id)
    } catch (cause) {
      setNewChannelError(cause instanceof Error ? cause.message : 'The channel was not created.')
    }
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col border-t border-worktree-sidebar-border/60 bg-worktree-sidebar"
      aria-label="Team room"
    >
      <div className="flex min-h-10 items-center gap-2 px-3">
        <MessageSquareText aria-hidden className="size-3.5 text-worktree-sidebar-foreground/45" />
        <span className="text-xs font-semibold text-worktree-sidebar-foreground/85">Team room</span>
        <span className="ml-auto text-[10px] text-worktree-sidebar-foreground/40">Shared chat</span>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {error ? (
          <p className="px-2 py-1 text-[11px] text-worktree-sidebar-foreground/45">{error}</p>
        ) : null}
        <ul>
          {channels.map((channel) => (
            <li key={channel.id}>
              <button
                type="button"
                aria-current={channel.id === openChannelId ? 'page' : undefined}
                onClick={() => openChannel(channel.id)}
                className={cn(
                  'flex min-h-9 w-full items-center gap-1.5 rounded-md px-2 text-left hover:bg-worktree-sidebar-foreground/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring',
                  channel.id === openChannelId && 'bg-worktree-sidebar-accent/70'
                )}
              >
                <Hash
                  aria-hidden
                  className="size-3.5 shrink-0 text-worktree-sidebar-foreground/40"
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
                  <span className="ml-auto rounded-full bg-primary px-1.5 py-px text-[9px] font-semibold text-primary-foreground">
                    {channel.unreadCount}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          {channels.length === 0 ? (
            <li className="px-2 py-2 text-[11px] text-worktree-sidebar-foreground/40">
              No team conversations yet.
            </li>
          ) : null}
        </ul>
        {canCreateChannel ? (
          newChannelOpen ? (
            <form onSubmit={createChannel} className="flex flex-col gap-1 px-2 py-1.5">
              <div className="flex items-center gap-1">
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
                  placeholder="project-updates"
                  className="min-h-8 min-w-0 flex-1 rounded border border-worktree-sidebar-border/70 bg-worktree-sidebar-foreground/5 px-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring"
                />
                <button
                  type="submit"
                  className="min-h-8 rounded bg-worktree-sidebar-accent px-2 text-[11px] text-worktree-sidebar-accent-foreground"
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
              className="mx-2 mt-1 flex min-h-8 items-center gap-1 rounded px-2 text-[11px] text-worktree-sidebar-foreground/55 hover:bg-worktree-sidebar-foreground/8"
            >
              <Plus aria-hidden className="size-3" /> New conversation
            </button>
          )
        ) : null}
      </div>
    </section>
  )
}
