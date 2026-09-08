import type { JSX, ReactNode } from 'react'

export type MissionControlCoordination = {
  claims: {
    id: string
    sessionId: string
    worktreeId: string | null
    branch: string | null
    agentLabel: string
    path: string
    status: 'active' | 'contested'
    createdAt?: string
  }[]
  contests: {
    paths: string[]
    holders: { sessionId: string; agentLabel: string; paths: string[] }[]
  }[]
  overlaps: {
    id: string
    sessionIds: string[]
    agentLabels: string[]
    kind: string
    score: number
    rationale: string
    detectedAt?: string
  }[]
  messages?: {
    id: string
    fromSessionId: string
    toSessionId: string
    fromAgentLabel: string
    toAgentLabel: string
    sessionIds: [string, string]
    worktreeIds: (string | null)[]
    kind: 'claim_request' | 'claim_response' | 'handoff' | 'note'
    status: 'pending' | 'delivered' | 'resolved'
    summary: string
    detail: string | null
    createdAt: string
  }[]
}

export const EMPTY_MISSION_CONTROL_COORDINATION: MissionControlCoordination = {
  claims: [],
  contests: [],
  overlaps: []
}

export type MissionControlActivityItem = {
  id: string
  kind: 'claim' | 'overlap' | 'message'
  title: string
  detail: string | null
  state: string
  timestamp: string
  sessionIds: string[]
  worktreeIds: string[]
}

export function missionControlActivityItems(
  coordination: MissionControlCoordination
): MissionControlActivityItem[] {
  const claims = coordination.claims.map<MissionControlActivityItem>((claim) => ({
    id: `claim:${claim.id}`,
    kind: 'claim',
    title: `${claim.agentLabel} claimed ${claim.path}`,
    detail: null,
    state: claim.status,
    timestamp: claim.createdAt ?? '',
    sessionIds: [claim.sessionId],
    worktreeIds: claim.worktreeId ? [claim.worktreeId] : []
  }))
  const overlaps = coordination.overlaps.map<MissionControlActivityItem>((overlap) => ({
    id: `overlap:${overlap.id}`,
    kind: 'overlap',
    title: `${overlap.agentLabels.join(' and ')} may be working on related areas`,
    detail: overlap.rationale,
    state: 'needs attention',
    timestamp: overlap.detectedAt ?? '',
    sessionIds: overlap.sessionIds,
    worktreeIds: []
  }))
  const messages = (coordination.messages ?? []).map<MissionControlActivityItem>((message) => ({
    id: `message:${message.id}`,
    kind: 'message',
    title: message.summary,
    detail: message.detail,
    state: message.status,
    timestamp: message.createdAt,
    sessionIds: message.sessionIds,
    worktreeIds: message.worktreeIds.filter((id): id is string => Boolean(id))
  }))
  return [...claims, ...overlaps, ...messages]
    .sort((one, other) => Date.parse(other.timestamp) - Date.parse(one.timestamp))
    .slice(0, 20)
}

function activityTime(timestamp: string, now: number): string {
  const elapsed = Math.max(0, now - Date.parse(timestamp))
  if (!Number.isFinite(elapsed)) {
    return 'Recently'
  }
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) {
    return 'Just now'
  }
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  return `${Math.floor(hours / 24)}d ago`
}

export function ActivitySection({
  title,
  count,
  children
}: {
  title: string
  count?: number
  children: ReactNode
}): JSX.Element {
  const headingId = `codev-activity-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section className="codev-mc-section" aria-labelledby={headingId}>
      <div className="codev-mc-section-head">
        <h4 id={headingId}>{title}</h4>
        {typeof count === 'number' ? <span>{count}</span> : null}
      </div>
      {children}
    </section>
  )
}

export function ActivityTimeline({
  items,
  now,
  onOpenContext
}: {
  items: MissionControlActivityItem[]
  now: number
  onOpenContext: (sessionIds: string[], worktreeIds: string[]) => void
}): JSX.Element {
  return (
    <ol className="codev-mc-timeline">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className={`codev-mc-event is-${item.kind}`}
            onClick={() => onOpenContext(item.sessionIds, item.worktreeIds)}
            aria-label={`${item.title}. Open related work`}
          >
            <span className="codev-mc-event-rail" aria-hidden>
              <i />
            </span>
            <span className="codev-mc-event-body">
              <strong>{item.title}</strong>
              {item.detail ? <span>{item.detail}</span> : null}
              <span className="codev-mc-event-meta">
                {activityTime(item.timestamp, now)} · {item.state}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}
