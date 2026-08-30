import { useSyncExternalStore, type JSX } from 'react'
import type { Worktree } from '../../../../shared/types'
import { getCodevProposalWorktreeId } from '../../web/codev-proposal-discard'
import type { CodevWorkboardSlot, CodevWorkboardSnapshot } from './CodevWorkboardView'
import { CodevWorktreePathClaims } from './codev-path-claims-store'

let snapshot: CodevWorkboardSnapshot | null = null
let startSession: (() => Promise<void>) | null = null
const listeners = new Set<() => void>()

export function publishCodevWorkboard(next: CodevWorkboardSnapshot | null): void {
  snapshot = next
  for (const listener of listeners) {
    listener()
  }
}

export function setCodevWorkboardStartSession(next: (() => Promise<void>) | null): void {
  startSession = next
}

export async function startCodevWorkboardSession(): Promise<void> {
  await startSession?.()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): CodevWorkboardSnapshot | null {
  return snapshot
}

export function useCodevWorkboardSlot(worktree: Pick<Worktree, 'path' | 'comment'>): CodevWorkboardSlot | null {
  const board = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const worktreeId = getCodevProposalWorktreeId(worktree.path, worktree.comment)
  if (!worktreeId || !board?.slots) {
    return null
  }
  return board.slots.find((slot) => slot.worktreeId === worktreeId) ?? null
}

export function CodevWorktreeSlotMeta({
  worktree
}: {
  worktree: Pick<Worktree, 'path' | 'comment'>
}): JSX.Element | null {
  const slot = useCodevWorkboardSlot(worktree)
  if (!slot) {
    return null
  }
  return (
    <div
      className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-worktree-sidebar-border pt-2 text-[11px]"
      aria-label={`Agent slot ${slot.slot} details`}
      data-codev-worktree-slot={slot.slot}
    >
      <div>
        <span className="block text-[10px] uppercase text-muted-foreground">Assignment</span>
        <strong>{slot.assignment}</strong>
      </div>
      <div>
        <span className="block text-[10px] uppercase text-muted-foreground">Owner</span>
        <strong>{slot.owner}</strong>
      </div>
      <div>
        <span className="block text-[10px] uppercase text-muted-foreground">Provider</span>
        <strong>{slot.provider}</strong>
      </div>
      <div>
        <span className="block text-[10px] uppercase text-muted-foreground">Status</span>
        <strong>{slot.status}</strong>
      </div>
      <div>
        <span className="block text-[10px] uppercase text-muted-foreground">Elapsed</span>
        <strong>{slot.elapsed}</strong>
      </div>
      <div>
        <span className="block text-[10px] uppercase text-muted-foreground">Current task</span>
        <strong>{slot.currentTask}</strong>
      </div>
      <div className="col-span-2">
        <CodevWorktreePathClaims worktree={worktree} />
      </div>
    </div>
  )
}
