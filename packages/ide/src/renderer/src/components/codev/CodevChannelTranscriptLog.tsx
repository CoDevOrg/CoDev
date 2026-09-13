import type { JSX, RefObject, UIEventHandler } from 'react'
import { Sparkles } from 'lucide-react'
import { AGENT_MENTION, formatChatTime, MemberAvatar, type MessageGroup } from './codev-team-shared'

export type ChannelTranscriptState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'failed'; message: string }

/**
 * The scrolling transcript of a channel: the older-history control, the
 * distinct loading / empty / failed / stale states, and the grouped messages.
 * The pane owns the data and the scroll position; this only renders them.
 */
export function ChannelTranscriptLog({
  scrollRef,
  onScroll,
  slug,
  groups,
  channelError,
  transcript,
  mayHaveOlder,
  loadingOlder,
  onLoadOlder,
  onRetry
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll: UIEventHandler<HTMLDivElement>
  slug: string
  groups: MessageGroup[]
  channelError: string | null
  transcript: ChannelTranscriptState
  mayHaveOlder: boolean
  loadingOlder: 'idle' | 'loading' | 'failed'
  onLoadOlder: () => void
  onRetry: () => void
}): JSX.Element {
  return (
    <div
      ref={scrollRef}
      role="log"
      onScroll={onScroll}
      className="scrollbar-sleek mx-auto w-full max-w-3xl min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
    >
      {channelError ? <p className="text-xs text-destructive">{channelError}</p> : null}
      {mayHaveOlder && transcript.status !== 'loading' ? (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={onLoadOlder}
            disabled={loadingOlder === 'loading'}
            className="rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-accent disabled:opacity-50"
          >
            {loadingOlder === 'loading' ? 'Loading earlier messages…' : 'Load earlier messages'}
          </button>
          {loadingOlder === 'failed' ? (
            <span className="text-destructive">Couldn’t load earlier messages.</span>
          ) : null}
        </p>
      ) : null}
      {transcript.status === 'failed' ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
          <span>
            {groups.length === 0
              ? `Couldn’t load this channel’s messages: ${transcript.message}`
              : `Messages may be behind — the last refresh failed: ${transcript.message}`}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-border px-1.5 py-0.5 text-xs text-foreground hover:bg-accent"
          >
            Retry
          </button>
        </p>
      ) : null}
      {transcript.status === 'loading' && groups.length === 0 ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading #{slug}…
        </p>
      ) : null}
      {transcript.status === 'ready' && groups.length === 0 ? (
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
  )
}
