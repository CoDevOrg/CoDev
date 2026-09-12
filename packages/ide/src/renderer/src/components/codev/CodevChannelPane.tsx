import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent
} from 'react'
import { ArrowDown, ArrowLeft, Hash, Lock, Send, Sparkles } from 'lucide-react'
import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'
import { requestCodevBridge } from '@/web/codev-bridge-singleton'
import {
  CHANNEL_PAGE_SIZE,
  countNewMessages,
  mergeChannelMessages,
  olderPageCursor,
  pageMayHaveMore
} from '@/web/codev-channel-transcript'
import { closeCodevChannel, useCodevChannelId } from '@/web/codev-channel-view'
import {
  getCodevChannelDraft,
  restoreUnsentChannelMessage,
  setCodevChannelDraft
} from '@/web/codev-channel-drafts'
import {
  AGENT_MENTION,
  groupMessages,
  type ChannelMessage,
  type ChannelSummary
} from './codev-team-shared'
import { ChannelTranscriptLog, type ChannelTranscriptState } from './CodevChannelTranscriptLog'

const MESSAGE_POLL_MS = 3_000
/** How close to the bottom still counts as "following" new messages. */
const FOLLOW_THRESHOLD_PX = 48

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
 *
 * z-20 is load-bearing: the chat lives in a `z-10` layer inside `.pane`, which
 * is `position: relative; z-index: auto` and so shares this stacking context.
 * Anything below 10 leaves only this header visible over a still-live chat.
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
  const [messages, setMessagesState] = useState<ChannelMessage[]>([])
  // Every write goes through the ref so a poll, a send and an older page
  // reconcile against the same latest transcript, without side effects in
  // a state updater.
  const messagesRef = useRef<ChannelMessage[]>([])
  const applyMessages = useCallback((incoming: readonly ChannelMessage[]): ChannelMessage[] => {
    const previous = messagesRef.current
    const next = mergeChannelMessages(previous, incoming)
    messagesRef.current = next
    setMessagesState(next)
    return previous
  }, [])
  const [notice, setNotice] = useState<string | null>(null)
  // Metadata and transcript fail independently, so each has its own error;
  // a transcript poll succeeding must not erase a channel-metadata failure.
  const [channelError, setChannelError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<ChannelTranscriptState>({ status: 'loading' })
  const [transcriptAttempt, setTranscriptAttempt] = useState(0)
  // Older history: a full first page means there may be more before it.
  const [mayHaveOlder, setMayHaveOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState<'idle' | 'loading' | 'failed'>('idle')
  // New-message handling for a reader who has scrolled up: the log stays put
  // and a pill counts what arrived below, instead of yanking them down.
  const [unseen, setUnseen] = useState(0)
  const followRef = useRef(true)
  const scrollToBottomRef = useRef(false)
  // Restores the reader's place after an older page is prepended.
  const prependAnchorRef = useRef<{ height: number; top: number } | null>(null)
  const pollInFlightRef = useRef(false)
  const [sending, setSending] = useState(false)
  // The draft outlives this component: it is remounted on every channel
  // switch and every "Back to chat", which used to discard unsent text.
  const [draft, setDraftState] = useState(() => getCodevChannelDraft(channelId))
  const setDraft = useCallback(
    (next: string | ((current: string) => string)): void => {
      setDraftState((current) => {
        const value = typeof next === 'function' ? next(current) : next
        setCodevChannelDraft(channelId, value)
        return value
      })
    },
    [channelId]
  )
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
          setChannelError(cause instanceof Error ? cause.message : 'Team chat is offline.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [channelId])

  useEffect(() => {
    let cancelled = false
    let first = true
    const load = async (): Promise<void> => {
      // Polls are serialized: an overlapping read could return out of order
      // and put an older page on top of a newer one.
      if (pollInFlightRef.current) {
        return
      }
      pollInFlightRef.current = true
      try {
        const payload = await requestCodevBridge<{ messages?: ChannelMessage[] }>('team.messages', {
          channelId,
          limit: CHANNEL_PAGE_SIZE
        })
        if (cancelled) {
          return
        }
        const page = payload.messages ?? []
        if (first) {
          first = false
          setMayHaveOlder(pageMayHaveMore(page))
        }
        // Merge, never replace: the latest page must not erase older pages
        // the reader loaded, nor a message this client just sent.
        const previous = applyMessages(page)
        if (!followRef.current) {
          const arrived = countNewMessages(previous, page)
          if (arrived > 0) {
            setUnseen((count) => count + arrived)
          }
        }
        setTranscript({ status: 'ready' })
      } catch (cause) {
        // A failed load is a failed load, not an empty channel. Messages
        // already on screen stay; the state says they may be behind.
        if (!cancelled) {
          setTranscript({
            status: 'failed',
            message: cause instanceof Error ? cause.message : 'Team chat is offline.'
          })
        }
      } finally {
        pollInFlightRef.current = false
      }
    }
    void load()
    const timer = setInterval(() => void load(), MESSAGE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [applyMessages, channelId, transcriptAttempt])

  const loadOlder = useCallback(async (): Promise<void> => {
    const before = olderPageCursor(messages)
    if (!before || loadingOlder === 'loading') {
      return
    }
    setLoadingOlder('loading')
    const node = scrollRef.current
    prependAnchorRef.current = node ? { height: node.scrollHeight, top: node.scrollTop } : null
    try {
      const payload = await requestCodevBridge<{ messages?: ChannelMessage[] }>('team.messages', {
        channelId,
        before,
        limit: CHANNEL_PAGE_SIZE
      })
      const page = payload.messages ?? []
      setMayHaveOlder(pageMayHaveMore(page))
      applyMessages(page)
      setLoadingOlder('idle')
    } catch {
      prependAnchorRef.current = null
      setLoadingOlder('failed')
    }
  }, [applyMessages, channelId, loadingOlder, messages])

  // Focus moves into the composer while the channel is up, and goes back to
  // whatever had it — usually the agent composer — when the layer drops.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    composerRef.current?.focus()
    return () => {
      if (previous?.isConnected) {
        previous.focus()
      }
    }
  }, [])

  const groups = useMemo(() => groupMessages(messages), [messages])

  const onScroll = useCallback((): void => {
    const node = scrollRef.current
    if (!node) {
      return
    }
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    const following = distance <= FOLLOW_THRESHOLD_PX
    followRef.current = following
    if (following) {
      setUnseen(0)
    }
  }, [])

  const scrollToBottom = useCallback((): void => {
    const node = scrollRef.current
    if (node) {
      node.scrollTop = node.scrollHeight
    }
    followRef.current = true
    setUnseen(0)
  }, [])

  // Follow new messages only while the reader is at the bottom or has just
  // sent one; keep their place when an older page lands above them.
  useEffect(() => {
    const node = scrollRef.current
    if (!node) {
      return
    }
    const anchor = prependAnchorRef.current
    if (anchor) {
      prependAnchorRef.current = null
      node.scrollTop = anchor.top + (node.scrollHeight - anchor.height)
      return
    }
    if (followRef.current || scrollToBottomRef.current) {
      scrollToBottomRef.current = false
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
      // Reconciled by id: a poll may already have delivered this message.
      scrollToBottomRef.current = true
      applyMessages([payload.message])
      if (payload.agentDispatch) {
        setNotice(
          payload.agentDispatch.dispatched
            ? 'Sent to the running agent — its reply will land in this channel.'
            : `The agent was not reached: ${payload.agentDispatch.reason ?? 'no active session'}`
        )
      }
    } catch (cause) {
      // The text comes back rather than vanishing with the error.
      setDraft((current) => restoreUnsentChannelMessage(body, current))
      setNotice(
        `Not sent — ${cause instanceof Error ? cause.message : 'the server did not accept it'}. Your message is back in the composer.`
      )
    } finally {
      setSending(false)
    }
  }, [applyMessages, channelId, draft, sending, setDraft])

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter that only commits an IME candidate must not send.
    if (isImeCompositionKeyDown(event)) {
      return
    }
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
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-background"
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

      <ChannelTranscriptLog
        scrollRef={scrollRef}
        onScroll={onScroll}
        slug={slug}
        groups={groups}
        channelError={channelError}
        transcript={transcript}
        mayHaveOlder={mayHaveOlder}
        loadingOlder={loadingOlder}
        onLoadOlder={() => void loadOlder()}
        onRetry={() => setTranscriptAttempt((attempt) => attempt + 1)}
      />

      {unseen > 0 ? (
        <div className="mx-auto flex w-full max-w-3xl justify-center px-4">
          <button
            type="button"
            onClick={scrollToBottom}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground shadow-sm hover:bg-accent"
          >
            <ArrowDown aria-hidden className="size-3" />
            {unseen === 1 ? '1 new message' : `${unseen} new messages`}
          </button>
        </div>
      ) : null}
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
