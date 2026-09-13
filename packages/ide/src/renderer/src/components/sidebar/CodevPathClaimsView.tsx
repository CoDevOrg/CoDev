import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

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

/**
 * The claim group the controls act on. With a target path — the file open in
 * the editor — it is that path's group or nothing; the panel used to pick a
 * contested group or the first one and then describe it as if it were the
 * current file. Without a target, a contested group still deserves the
 * member's attention, so it is shown for resolution.
 */
export function targetPathClaimGroup(
  groups: CodevPathClaimGroup[],
  targetPath: string | null | undefined
): CodevPathClaimGroup | null {
  if (targetPath) {
    return groups.find((group) => group.path === targetPath) ?? null
  }
  return groups.find((group) => group.contested) ?? groups[0] ?? null
}

/** A contested path other than the target, so it is not silently hidden. */
export function contestedElsewhere(
  groups: CodevPathClaimGroup[],
  target: CodevPathClaimGroup | null
): CodevPathClaimGroup | null {
  return groups.find((group) => group.contested && group !== target) ?? null
}

export function CodevPathClaimsViewPanel({
  connected,
  snapshot,
  targetPath = null,
  agentSessionId = null,
  onSelectAgent,
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
  /** The file the claim is for: the one open in the editor. Null when no
   *  file is open, in which case there is nothing to claim. */
  targetPath?: string | null
  /** The managed session the claim is made for; chosen by the member. */
  agentSessionId?: string | null
  onSelectAgent?: (sessionId: string) => void
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
  const group = targetPathClaimGroup(groups, targetPath)
  const elsewhere = contestedElsewhere(groups, group)
  const path = targetPath ?? group?.path ?? null
  const agent = slots.find((slot) => slot.sessionId === agentSessionId) ?? slots[0] ?? null
  const otherAgent = slots.find((slot) => slot.sessionId !== agent?.sessionId) ?? null
  const live =
    group?.claims.filter((claim) => claim.status === 'active' || claim.status === 'contested') ?? []
  const canStart = Boolean(agent?.sessionId) && Boolean(targetPath) && live.length === 0
  const canOverlap =
    Boolean(otherAgent?.sessionId) && Boolean(targetPath) && live.length === 1 && !group?.contested
  const canResolve = Boolean(group?.contested && group.reassignClaimId)
  const noAgents = slots.length === 0

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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy === 'refresh'}
          onClick={onRefresh}
        >
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh claims'}
        </Button>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        {!connected
          ? 'Waiting for the workspace-bound CoDev bridge.'
          : noAgents
            ? 'Claims apply to managed agent sessions. None is running, so there is nothing to claim for yet.'
            : !targetPath
              ? 'Open a file in the editor to claim it for an agent. A claim covers the file that agent will write.'
              : `Agent slot ${agent?.slot ?? '—'} must claim ${targetPath} before it writes there. Overlaps stay contested until reassigned or cancelled.`}
      </p>
      {connected && slots.length > 1 && onSelectAgent ? (
        <div className="mb-2">
          <label
            htmlFor="codev-path-claims-agent"
            className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            Claim as
          </label>
          <Select
            value={agent?.sessionId ?? ''}
            onValueChange={onSelectAgent}
            disabled={Boolean(busy)}
          >
            <SelectTrigger id="codev-path-claims-agent" size="sm" className="h-8 w-full text-xs">
              <SelectValue placeholder="Choose an agent…" />
            </SelectTrigger>
            <SelectContent>
              {slots.map((slot) => (
                <SelectItem key={slot.sessionId ?? slot.slot} value={slot.sessionId ?? ''}>
                  Slot {slot.slot} · {slot.assignment}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {group?.contested && group.warningTitle ? (
        <div
          className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs"
          role="alert"
        >
          <strong>{group.warningTitle}</strong>
          {group.warningDetail ? <p className="mt-1">{group.warningDetail}</p> : null}
        </div>
      ) : snapshot?.notice ? (
        <div
          className="mb-2 rounded-md border border-border bg-background/80 p-2 text-xs"
          role="alert"
        >
          <strong>{snapshot.notice}</strong>
        </div>
      ) : live.length > 0 && path ? (
        <p className="mb-2 text-xs" role="status">
          {path} is claimed · that agent may write it.
        </p>
      ) : targetPath && !noAgents ? (
        <p className="mb-2 text-xs text-muted-foreground" role="status">
          No claim on {targetPath} yet.
        </p>
      ) : null}
      {elsewhere ? (
        <p className="mb-2 text-xs text-muted-foreground" role="status">
          {elsewhere.path} is contested elsewhere in this workspace. Open it to resolve the overlap.
        </p>
      ) : null}
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
          {busy === 'create'
            ? 'Claiming…'
            : live.length > 0 && targetPath
              ? 'Path claimed'
              : targetPath
                ? `Claim ${targetPath}`
                : 'Claim the open file'}
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
