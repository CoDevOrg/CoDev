import type { JSX } from 'react'
import { Button } from '@/components/ui/button'

export type CodevWorkboardSlot = {
  slot: 1 | 2 | 3
  occupied: boolean
  sessionId: string | null
  worktreeId: string | null
  assignment: string
  owner: string
  provider: string
  status: string
  worktree: string
  currentTask: string
  elapsed: string
}

export type CodevWorkboardCapacity = {
  maxActiveSessions: 3
  activeSessions: number
  availableSlots: number
}

export type CodevWorkboardRejection = {
  status: 409
  title: string
  message: string
}

export type CodevWorkboardSnapshot = {
  viewer?: { id: string; name: string; canCoSteer: boolean }
  capacity?: CodevWorkboardCapacity
  slots?: CodevWorkboardSlot[]
  created?: { sessionId: string; worktreeId: string } | null
  rejection?: CodevWorkboardRejection | null
}

const EMPTY_SLOTS: CodevWorkboardSlot[] = [
  {
    slot: 1,
    occupied: false,
    sessionId: null,
    worktreeId: null,
    assignment: 'Available',
    owner: 'Unassigned',
    provider: '—',
    status: 'Available',
    worktree: 'No worktree',
    currentTask: 'Start an agent session to fill this slot.',
    elapsed: '00:00'
  },
  {
    slot: 2,
    occupied: false,
    sessionId: null,
    worktreeId: null,
    assignment: 'Available',
    owner: 'Unassigned',
    provider: '—',
    status: 'Available',
    worktree: 'No worktree',
    currentTask: 'Start an agent session to fill this slot.',
    elapsed: '00:00'
  },
  {
    slot: 3,
    occupied: false,
    sessionId: null,
    worktreeId: null,
    assignment: 'Available',
    owner: 'Unassigned',
    provider: '—',
    status: 'Available',
    worktree: 'No worktree',
    currentTask: 'Start an agent session to fill this slot.',
    elapsed: '00:00'
  }
]

export function CodevWorkboardViewPanel({
  connected,
  capacity,
  slots,
  rejection,
  busy,
  canCoSteer,
  onRefresh,
  onStart
}: {
  connected: boolean
  capacity: CodevWorkboardCapacity | null
  slots: CodevWorkboardSlot[]
  rejection: CodevWorkboardRejection | null
  busy: string
  canCoSteer: boolean
  onRefresh: () => void
  onStart: () => void
}): JSX.Element {
  const available = capacity?.availableSlots ?? 0
  const filled = capacity?.activeSessions ?? slots.filter((slot) => slot.occupied).length
  const startLabel =
    filled >= 3 ? 'Start fourth session' : available === 2 ? 'Start second session' : 'Start agent session'

  return (
    <section
      className="border-b border-worktree-sidebar-border px-4 py-3"
      aria-labelledby="codev-workboard-heading"
      data-codev-workboard="true"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            CoDev · three-slot workboard
          </p>
          <h2 id="codev-workboard-heading" className="text-sm font-semibold">
            Agent worktree slots
          </h2>
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={busy === 'refresh'} onClick={onRefresh}>
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh workboard'}
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {connected
          ? `${filled} of 3 agent slots in use. Native worktree cards show assignment, owner, provider, status, and elapsed time.`
          : 'Waiting for the workspace-bound CoDev bridge.'}
      </p>
      <div className="grid grid-cols-3 gap-2" aria-label="Active agent workboard slots">
        {(slots.length === 3 ? slots : EMPTY_SLOTS).map((slot) => (
          <article
            key={slot.slot}
            className="rounded-md border border-worktree-sidebar-border bg-background/60 p-2 text-xs"
            aria-label={`Agent slot ${slot.slot}`}
          >
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Slot 0{slot.slot}
            </span>
            <strong className="mt-1 block">{slot.assignment}</strong>
            <dl className="mt-2 space-y-1">
              <div>
                <dt className="text-[10px] uppercase text-muted-foreground">Owner</dt>
                <dd>{slot.owner}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-muted-foreground">Provider</dt>
                <dd>{slot.provider}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-muted-foreground">Status</dt>
                <dd>{slot.status}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-muted-foreground">Worktree</dt>
                <dd className="break-all">{slot.worktree}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-muted-foreground">Current task</dt>
                <dd>{slot.currentTask}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-muted-foreground">Elapsed</dt>
                <dd>{slot.elapsed}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={!connected || !canCoSteer || busy === 'create'} onClick={onStart}>
          {busy === 'create' ? 'Checking capacity…' : startLabel}
        </Button>
        {!canCoSteer ? (
          <span className="text-[11px] text-muted-foreground">Co-steer permission is required to start a session.</span>
        ) : null}
      </div>
      {rejection ? (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs" role="alert">
          <strong>{rejection.title}</strong>
          <p className="mt-1">{rejection.message}</p>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground" role="status">
          {filled >= 3
            ? 'All three slots are filled. Starting another session asks the server to reject it.'
            : 'No fourth-session request has been made yet.'}
        </p>
      )}
    </section>
  )
}
