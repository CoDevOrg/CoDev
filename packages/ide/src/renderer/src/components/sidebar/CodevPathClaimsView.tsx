import type { JSX } from 'react'
import { Button } from '@/components/ui/button'

export type CodevPathClaimRecord = {
  id: string
  sessionId: string
  slot: 1 | 2 | 3 | null
  assignment: string
  owner: string
  worktreeId: string | null
  worktree: string
  path: string
  intent: string
  revision: string
  status: 'active' | 'contested' | 'released'
  displayStatus: 'Active' | 'Contested' | 'Released' | 'Cancelled'
  expiresAt: string
}

export type CodevPathClaimGroup = {
  path: string
  contested: boolean
  warningTitle: string | null
  warningDetail: string | null
  claims: CodevPathClaimRecord[]
  keepClaimId: string | null
  overlappingClaimId: string | null
  reassignSlot: 1 | 2 | 3 | null
  reassignClaimId: string | null
}

export type CodevPathClaimSlot = {
  slot: 1 | 2 | 3
  occupied: boolean
  sessionId: string | null
  assignment: string
}

export type CodevPathClaimsSnapshot = {
  viewer?: { id: string; name: string; canCoSteer: boolean }
  slots?: CodevPathClaimSlot[]
  groups?: CodevPathClaimGroup[]
  claims?: CodevPathClaimRecord[]
  defaultPath?: string
  defaultRevision?: string
  notice?: string | null
}

export function targetPathClaimGroup(
  groups: CodevPathClaimGroup[],
  defaultPath = 'README.md'
): CodevPathClaimGroup | null {
  return (
    groups.find((group) => group.contested) ??
    groups.find((group) => group.path === defaultPath) ??
    groups[0] ??
    null
  )
}

export function CodevPathClaimsViewPanel({
  connected,
  snapshot,
  busy,
  canCoSteer,
  onRefresh,
  onClaim,
  onOverlap,
  onReassign,
  onCancel
}: {
  connected: boolean
  snapshot: CodevPathClaimsSnapshot | null
  busy: string
  canCoSteer: boolean
  onRefresh: () => void
  onClaim: () => void
  onOverlap: () => void
  onReassign: () => void
  onCancel: () => void
}): JSX.Element {
  const groups = snapshot?.groups ?? []
  const slots = (snapshot?.slots ?? []).filter((slot) => slot.occupied && slot.sessionId)
  const group = targetPathClaimGroup(groups, snapshot?.defaultPath)
  const path = group?.path ?? snapshot?.defaultPath ?? 'README.md'
  const live = group?.claims.filter((claim) => claim.status === 'active' || claim.status === 'contested') ?? []
  const canStart = Boolean(slots[0]?.sessionId) && live.length === 0
  const canOverlap = Boolean(slots[1]?.sessionId) && live.length === 1 && !group?.contested
  const canResolve = Boolean(group?.contested && group.reassignClaimId)

  return (
    <section
      className="border-b border-border px-3 py-2"
      aria-labelledby="codev-path-claims-heading"
      data-codev-path-claims="true"
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            CoDev · path claims
          </p>
          <h2 id="codev-path-claims-heading" className="text-sm font-semibold">
            Explorer write claims
          </h2>
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={busy === 'refresh'} onClick={onRefresh}>
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh claims'}
        </Button>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        {connected
          ? `Agent slot 1 must claim ${path} before a write is allowed. Overlaps stay contested until reassigned or cancelled.`
          : 'Waiting for the workspace-bound CoDev bridge.'}
      </p>
      {group?.contested && group.warningTitle ? (
        <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs" role="alert">
          <strong>{group.warningTitle}</strong>
          {group.warningDetail ? <p className="mt-1">{group.warningDetail}</p> : null}
        </div>
      ) : snapshot?.notice ? (
        <div className="mb-2 rounded-md border border-border bg-background/80 p-2 text-xs" role="alert">
          <strong>{snapshot.notice}</strong>
        </div>
      ) : live.length > 0 ? (
        <p className="mb-2 text-xs" role="status">
          Claim active · agent write is now allowed.
        </p>
      ) : (
        <p className="mb-2 text-xs text-muted-foreground" role="status">
          No active path claim · agent write is blocked.
        </p>
      )}
      {group ? (
        <div className="mb-2 space-y-1" aria-label="Overlapping claims">
          {group.claims.map((claim) => (
            <div key={claim.id} className="flex items-center justify-between gap-2 text-[11px]">
              <span>
                Agent slot {claim.slot ?? '—'} · {claim.assignment}
              </span>
              <code>
                {claim.path} · {claim.displayStatus}
              </code>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!connected || !canCoSteer || !canStart || Boolean(busy)}
          onClick={onClaim}
        >
          {busy === 'create' ? 'Claiming…' : live.length > 0 ? 'Path claimed' : 'Start agent claim'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!connected || !canCoSteer || !canOverlap || Boolean(busy)}
          onClick={onOverlap}
        >
          {busy === 'overlap' ? 'Contesting…' : 'Request overlapping claim'}
        </Button>
        {canResolve ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={!connected || !canCoSteer || Boolean(busy)}
              onClick={onReassign}
            >
              {busy === 'reassign'
                ? 'Reassigning…'
                : `Reassign to slot ${group?.reassignSlot ?? 2}`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!connected || !canCoSteer || Boolean(busy)}
              onClick={onCancel}
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel overlapping claim'}
            </Button>
          </>
        ) : null}
      </div>
    </section>
  )
}
