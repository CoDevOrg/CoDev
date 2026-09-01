import { useSyncExternalStore, type JSX } from 'react'
import type { Worktree } from '../../../../shared/types'
import { getCodevProposalWorktreeId } from '../../web/codev-proposal-discard'
import { requestCodevBridge } from '../../web/codev-bridge-singleton'
import { Button } from '@/components/ui/button'
import {
  targetPathClaimGroup,
  type CodevPathClaimGroup,
  type CodevPathClaimRecord,
  type CodevPathClaimsSnapshot
} from './CodevPathClaimsView'

let snapshot: CodevPathClaimsSnapshot | null = null
const listeners = new Set<() => void>()

export function publishCodevPathClaims(next: CodevPathClaimsSnapshot | null): void {
  snapshot = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): CodevPathClaimsSnapshot | null {
  return snapshot
}

export function useCodevPathClaims(): CodevPathClaimsSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function claimGroupForPath(
  groups: CodevPathClaimGroup[],
  relativePath: string
): CodevPathClaimGroup | null {
  return (
    groups.find((group) => {
      if (group.path === relativePath) return true
      if (group.path.endsWith('/**')) {
        const directory = group.path.slice(0, -3)
        return relativePath === directory || relativePath.startsWith(`${directory}/`)
      }
      return false
    }) ?? null
  )
}

export function CodevExplorerPathClaimBadge({
  relativePath
}: {
  relativePath: string
}): JSX.Element | null {
  const claims = useCodevPathClaims()
  const group = claimGroupForPath(claims?.groups ?? [], relativePath)
  if (!group) {
    return null
  }
  const live = group.claims.some((claim) => claim.status === 'active' || claim.status === 'contested')
  if (!live && !group.claims.length) {
    return null
  }
  const label = group.contested ? 'Contested' : group.claims.some((claim) => claim.status === 'active') ? 'Claimed' : 'Released'
  return (
    <span
      className="ml-1 shrink-0 rounded-sm border border-border px-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"
      aria-label={`${relativePath} ${label}`}
      data-codev-path-claim={group.contested ? 'contested' : 'active'}
    >
      {label}
    </span>
  )
}

function claimsForWorktree(
  claims: CodevPathClaimsSnapshot | null,
  worktree: Pick<Worktree, 'path' | 'comment'>
): { slotClaims: CodevPathClaimRecord[]; group: CodevPathClaimGroup | null } {
  const worktreeId = getCodevProposalWorktreeId(worktree.path, worktree.comment)
  const groups = claims?.groups ?? []
  const slotClaims = (claims?.claims ?? []).filter((claim) => claim.worktreeId === worktreeId)
  const group =
    groups.find((entry) => entry.claims.some((claim) => claim.worktreeId === worktreeId)) ??
    targetPathClaimGroup(groups)
  return { slotClaims, group }
}

export function CodevWorktreePathClaims({
  worktree
}: {
  worktree: Pick<Worktree, 'path' | 'comment'>
}): JSX.Element | null {
  const claims = useCodevPathClaims()
  const { slotClaims, group } = claimsForWorktree(claims, worktree)
  if (!slotClaims.length && !group?.contested) {
    return null
  }
  const thisClaim = slotClaims[0] ?? null
  const canReassign = Boolean(group?.contested && thisClaim && (thisClaim.status === 'active' || thisClaim.status === 'contested'))
  const canCancel = Boolean(group?.contested && thisClaim && thisClaim.id === group?.overlappingClaimId)

  return (
    <div
      className="mt-2 border-t border-worktree-sidebar-border pt-2 text-[11px]"
      aria-label="Worktree path claims"
      data-codev-worktree-claims="true"
    >
      {group?.contested && group.warningTitle ? (
        <div className="mb-1 rounded-sm border border-destructive/40 bg-destructive/10 p-1.5" role="alert">
          <strong>{group.warningTitle}</strong>
        </div>
      ) : claims?.notice ? (
        <div className="mb-1 text-xs" role="status">
          {claims.notice}
        </div>
      ) : null}
      {slotClaims.map((claim) => (
        <div key={claim.id} className="flex items-center justify-between gap-2">
          <span>Path claim</span>
          <code>
            {claim.path} · {claim.displayStatus}
          </code>
        </div>
      ))}
      {canReassign || canCancel ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {canReassign && thisClaim ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void requestCodevBridge<CodevPathClaimsSnapshot>('claims.reassign', {
                  claimId: thisClaim.id
                }).then(publishCodevPathClaims)
              }}
            >
              Reassign to slot {thisClaim.slot ?? 2}
            </Button>
          ) : null}
          {canCancel && group?.overlappingClaimId ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                void requestCodevBridge<CodevPathClaimsSnapshot>('claims.cancel', {
                  claimId: group.overlappingClaimId
                }).then(publishCodevPathClaims)
              }}
            >
              Cancel overlapping claim
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
