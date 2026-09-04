import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent
} from 'react'
import { ArrowLeft, Hash, Lock, Send, Sparkles } from 'lucide-react'
import { requestCodevBridge } from '@/web/codev-bridge-singleton'
import { closeCodevChannel, useCodevChannelId } from '@/web/codev-channel-view'
import {
  AGENT_MENTION,
  formatChatTime,
  groupMessages,
  MemberAvatar,
  type ChannelMessage,
  type ChannelSummary
} from './codev-team-shared'

const MESSAGE_POLL_MS = 3_000

/**
 * A team channel, rendered in the middle of the workspace.
 *
 * The agent chat is the workspace's permanent center, so this does not replace
 * it in the pane model — it layers over it while the member is reading the
 * channel, leaving the chat (and any running agent) mounted and untouched
 * underneath. "Back to chat" drops the layer; the conversation the member left
 * is exactly where they left it.
 *
 * Rendering nothing when no channel is open keeps the whole surface out of the
 * tree for the common case, and outside the embedded client it never mounts.
 */
export function CodevChannelPane(): JSX.Element | null {
  const channelId = useCodevChannelId()
  if (!channelId) {
    return null
  }
  return <ChannelPaneBody key={channelId} channelId={channelId} />
}

function ChannelPaneBody({ channelId }: { channelId: string }): JSX.Element {
  const [channel, setChannel] = useState<ChannelSummary | null>(null)
  const [messages, setMessages] = useState<ChannelMessage[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  // Channel metadata (slug, topic, agent access) changes far more rarely than
  // the transcript, so it is read once per switch instead of on the poll.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const payload = await requestCodevBridge<{ channels?: ChannelSummary[] }>('team.channels')
        if (cancelled) {
          return
        }
        setChannel(payload.channels?.find((entry) => entry.id === channelId) ?? null)
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Team chat is offline.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [channelId])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const payload = await requestCodevBridge<{ messages?: ChannelMessage[] }>('team.messages', {
          channelId
        })
        if (!cancelled) {
          setMessages(payload.messages ?? [])
          setError(null)
        }
      } catch {
        // Keep the transcript on screen; the next tick may succeed.
      }
    }
    void load()
    const timer = setInterval(() => void load(), MESSAGE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [channelId])

  useEffect(() => {
    composerRef.current?.focus()
  }, [])

  const groups = useMemo(() => groupMessages(messages), [messages])

  useEffect(() => {
    const node = scrollRef.current
    if (node) {
      node.scrollTop = node.scrollHeight
    }
  }, [groups.length, messages.length])

  const submit = useCallback(async (): Promise<void> => {
    const body = draft.trim()
    if (!body || sending) {
      return
    }
    setDraft('')
    setSending(true)
    setNotice(null)
    try {
      const payload = await requestCodevBridge<{
        message: ChannelMessage
        agentDispatch?: { dispatched: boolean; reason?: string } | null
      }>('team.send', { channelId, body })
      setMessages((current) => [...current, payload.message])
      if (payload.agentDispatch) {
        setNotice(
          payload.agentDispatch.dispatched
            ? 'Sent to the running agent — its reply will land in this channel.'
            : `The agent was not reached: ${payload.agentDispatch.reason ?? 'no active session'}`
        )
      }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'The message was not sent.')
    } finally {
      setSending(false)
    }
  }, [channelId, draft, sending])

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
    if (event.key === 'Escape') {
      closeCodevChannel()
    }
  }

  const slug = channel?.slug ?? 'channel'

  return (
    <section
      aria-label={`#${slug}`}
      className="absolute inset-0 z-[5] flex min-h-0 flex-col bg-background"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <button
          type="button"
          onClick={closeCodevChannel}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          Back to chat
        </button>
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
          <Hash aria-hidden className="size-3.5 opacity-60" />
          <span className="truncate">{slug}</span>
          {channel && !channel.agentAccess ? (
            <Lock aria-hidden className="size-3 opacity-50" />
          ) : null}
        </span>
        {channel?.topic ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{channel.topic}</span>
        ) : null}
      </header>

      <div
        ref={scrollRef}
        role="log"
        className="scrollbar-sleek mx-auto w-full max-w-3xl min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            This is the start of #{slug}. Say hello, or mention{' '}
            <code className="rounded bg-accent px-1">{AGENT_MENTION}</code> to pull in the coding
            agent.
          </p>
        ) : null}
        {groups.map((group) => (
          <article key={group.key} className="flex gap-2.5">
            {group.authorKind === 'member' ? (
              <MemberAvatar
                avatarUrl={group.avatarUrl}
                name={group.authorName}
                online={false}
                size={26}
              />
            ) : (
              <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Sparkles aria-hidden className="size-3.5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <strong className="text-foreground">{group.authorName}</strong>
                {group.authorKind === 'agent' ? (
                  <span className="rounded bg-accent px-1 text-[9px] uppercase">agent</span>
                ) : null}
                <time dateTime={group.createdAt}>{formatChatTime(group.createdAt)}</time>
              </p>
              {group.messages.map((message) => (
                <p
                  key={message.id}
                  className="whitespace-pre-wrap break-words text-sm text-foreground/90"
                >
                  {message.body}
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>

      {notice ? (
        <p className="mx-auto w-full max-w-3xl px-4 py-1 text-xs text-muted-foreground">{notice}</p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4"
      >
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2">
          <textarea
            ref={composerRef}
            aria-label={`Message #${slug}`}
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Message #${slug}`}
            className="w-full resize-none bg-transparent px-1 py-1 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
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
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Sparkles aria-hidden className="size-3" />
              Ask the agent
            </button>
            <button
              type="submit"
              aria-label="Send message"
              disabled={sending || draft.trim().length === 0}
              className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
            >
              <Send aria-hidden className="size-3.5" />
            </button>
          </div>
        </div>
      </form>
    </section>
  )
}

export default CodevChannelPane
