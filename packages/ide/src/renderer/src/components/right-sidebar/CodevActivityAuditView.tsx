import type { JSX } from 'react'
import { Button } from '@/components/ui/button'

export type CodevActivityJumpKind = 'file' | 'session' | 'diff'

export type CodevActivityJump = {
  kind: CodevActivityJumpKind
  surface: 'explorer' | 'vault' | 'checks'
  label: string
  path: string | null
  sessionId: string | null
}

export type CodevActivityEvent = {
  id: string
  sequence: number
  type: string
  actor: string
  summary: string
  createdAt: string
  path: string | null
  sessionId: string | null
  jump: CodevActivityJump | null
}

export type CodevActivitySnapshot = {
  viewer?: { id: string; name: string }
  events: CodevActivityEvent[]
  filters: { kind: 'all' | CodevActivityJumpKind; query: string }
  filtered: CodevActivityEvent[]
}

export function filterCodevActivityEvents(
  events: CodevActivityEvent[],
  kind: 'all' | CodevActivityJumpKind,
  query: string
): CodevActivityEvent[] {
  const needle = query.trim().toLowerCase()
  return events.filter((event) => {
    if (kind !== 'all' && event.jump?.kind !== kind) return false
    if (!needle) return true
    return (
      event.summary.toLowerCase().includes(needle) ||
      event.type.toLowerCase().includes(needle) ||
      event.actor.toLowerCase().includes(needle) ||
      (event.path?.toLowerCase().includes(needle) ?? false)
    )
  })
}

export function CodevActivityAuditViewPanel({
  connected,
  snapshot,
  kind,
  query,
  busy,
  jumped,
  onKindChange,
  onQueryChange,
  onRefresh,
  onJump
}: {
  connected: boolean
  snapshot: CodevActivitySnapshot | null
  kind: 'all' | CodevActivityJumpKind
  query: string
  busy: string
  jumped: string
  onKindChange: (kind: 'all' | CodevActivityJumpKind) => void
  onQueryChange: (query: string) => void
  onRefresh: () => void
  onJump: (event: CodevActivityEvent) => void
}): JSX.Element {
  const rows = filterCodevActivityEvents(snapshot?.events ?? [], kind, query)
  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-2"
      aria-labelledby="codev-activity-heading"
      data-codev-activity-audit="true"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            CoDev · audit
          </p>
          <h2 id="codev-activity-heading" className="text-sm font-semibold">
            Workspace activity
          </h2>
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={busy === 'refresh'} onClick={onRefresh}>
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh activity'}
        </Button>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground" role="status">
        {connected
          ? 'Durable workspace actions appear here. Filter an event, then jump to Explorer, Agents, or Checks.'
          : 'Waiting for the workspace-bound CoDev bridge.'}
      </p>
      <div className="mb-2 flex flex-col gap-2">
        <label className="text-[11px]" htmlFor="codev-activity-filter">
          Activity filter
          <select
            id="codev-activity-filter"
            aria-label="Activity filter"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            value={kind}
            onChange={(event) => onKindChange(event.target.value as 'all' | CodevActivityJumpKind)}
          >
            <option value="all">All events</option>
            <option value="file">Files</option>
            <option value="session">Sessions</option>
            <option value="diff">Diffs</option>
          </select>
        </label>
        <label className="text-[11px]" htmlFor="codev-activity-query">
          Filter query
          <input
            id="codev-activity-query"
            aria-label="Filter query"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            value={query}
            placeholder="review_merged"
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
      </div>
      {jumped ? (
        <p className="mb-2 text-xs" role="status" aria-label="Activity jump result">
          {jumped}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto" role="list" aria-label="Workspace activity events">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground" role="status">
            No matching activity events.
          </p>
        ) : (
          rows.map((event) => (
            <article
              key={event.id}
              className="mb-2 rounded-md border border-border p-2"
              role="listitem"
              aria-label={event.summary}
            >
              <p className="text-xs font-medium">{event.summary}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                <code>{event.type}</code>
                {event.path ? (
                  <>
                    {' · '}
                    <code>{event.path}</code>
                  </>
                ) : null}
              </p>
              {event.jump ? (
                <Button
                  type="button"
                  size="sm"
                  className="mt-2"
                  disabled={!connected}
                  aria-label={event.jump.label}
                  onClick={() => onJump(event)}
                >
                  {event.jump.label}
                </Button>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  )
}
