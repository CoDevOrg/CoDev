import type { CodevWorkboardSnapshot } from '../sidebar/CodevWorkboardView'
import type { CodevSharedSessionView } from '../right-sidebar/codev-shared-session-model'

export type CodevConnectionState = 'connected' | 'reconnecting' | 'disconnected'

export type CodevFeedPhase =
  | 'loading'
  | 'live'
  | 'stale'
  | 'reconnecting'
  | 'failed'
  | 'reconciling'

export type CodevFeedState = {
  phase: CodevFeedPhase
  message: string | null
  /** A failed refresh after a successful snapshot leaves stale data visible. */
  staleSince: number | null
}

export type CodevProviderReadiness = 'ready' | 'blocked' | 'unknown'

export type CodevManagedAgentState =
  | 'starting'
  | 'working'
  | 'waiting'
  | 'paused'
  | 'failed'
  | 'stopped'

export type CodevManagedAgentStatus = {
  state: CodevManagedAgentState
  label: string
  detail: string
  providerReadiness: CodevProviderReadiness
  providerIssue: string | null
}

export type CodevSlotUsage = {
  used: number
  total: number
}

export type CodevReconciledStatus = {
  feed: CodevFeedState
  slots: CodevSlotUsage | null
  /** `true` means both server feeds describe the same live worktrees. */
  countsReconciled: boolean
  managedSessions: CodevSharedSessionView[]
}

type FeedInput<T> = {
  value: T | null
  loaded: boolean
  error: string | null
  hadSuccessfulSnapshot: boolean
  failedAt: number | null
}

type ReconcileInput = {
  bridge: CodevConnectionState
  workboard: FeedInput<CodevWorkboardSnapshot>
  sessions: FeedInput<CodevSharedSessionView[]>
}

function normalizedError(error: string | null): string | null {
  const value = error?.trim()
  return value || null
}

function activeWorktreeIdsFromWorkboard(snapshot: CodevWorkboardSnapshot | null): Set<string> {
  return new Set(
    (snapshot?.slots ?? [])
      .filter((slot) => slot.occupied)
      .map((slot) => slot.worktreeId?.trim() ?? '')
      .filter(Boolean)
  )
}

function activeWorktreeIdsFromSessions(sessions: readonly CodevSharedSessionView[]): Set<string> {
  return new Set(
    sessions
      .filter((view) => {
        if (view.worktreeStatus !== undefined) {
          return view.worktreeStatus === 'active' || view.worktreeStatus === 'frozen'
        }
        // Keep older embedded bundles useful while the backend rolls out the
        // authoritative worktree field. Durable terminal states are never
        // active; unknown/working states remain eligible for reconciliation.
        return !['completed', 'interrupted', 'failed'].includes(view.session.state)
      })
      .map((view) => view.session.worktreeId.trim())
      .filter(Boolean)
  )
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false
    }
  }
  return true
}

function feedState(input: ReconcileInput): CodevFeedState {
  if (input.bridge === 'reconnecting') {
    return {
      phase: 'reconnecting',
      message: 'Live collaboration data is reconnecting.',
      staleSince: input.workboard.failedAt ?? input.sessions.failedAt
    }
  }
  if (input.bridge === 'disconnected') {
    return {
      phase: 'reconnecting',
      message: 'Live collaboration data is disconnected.',
      staleSince: input.workboard.failedAt ?? input.sessions.failedAt
    }
  }

  const failures = [input.workboard, input.sessions]
    .filter((feed) => feed.error && feed.failedAt !== null)
    .sort((left, right) => (left.failedAt ?? 0) - (right.failedAt ?? 0))
  if (failures.length > 0) {
    const first = failures[0]!
    return {
      phase: first.hadSuccessfulSnapshot ? 'stale' : 'failed',
      message: normalizedError(first.error),
      staleSince: first.failedAt
    }
  }
  if (!input.workboard.loaded || !input.sessions.loaded) {
    return { phase: 'loading', message: null, staleSince: null }
  }

  const worktrees = activeWorktreeIdsFromWorkboard(input.workboard.value)
  const sessions = activeWorktreeIdsFromSessions(input.sessions.value ?? [])
  if (!sameSet(worktrees, sessions)) {
    return {
      phase: 'reconciling',
      message: 'Branch and agent status are being reconciled.',
      staleSince: null
    }
  }
  return { phase: 'live', message: null, staleSince: null }
}

/**
 * The authoritative display projection for the two live feeds used by the
 * branches overview and Mission Control. A slot is a worktree; a session is
 * an agent conversation. We only publish slot counts when their worktree sets
 * agree, so a refresh race cannot show a believable but contradictory `2 / 3`.
 */
export function reconcileCodevStatus(input: ReconcileInput): CodevReconciledStatus {
  const feed = feedState(input)
  const sessions = input.sessions.value ?? []
  const countsReconciled = feed.phase === 'live'
  const slots = countsReconciled
    ? {
        used: (input.workboard.value?.slots ?? []).filter((slot) => slot.occupied).length,
        total: input.workboard.value?.slots?.length ?? 0
      }
    : null
  return { feed, slots, countsReconciled, managedSessions: sessions }
}

/** Normalize the backend's durable session states before rendering them. */
export function managedAgentStatus(view: CodevSharedSessionView): CodevManagedAgentStatus {
  const providerIssue =
    view.connectionBlocked ?? (view.session.state === 'failed' ? (view.lastError ?? null) : null)
  const providerReadiness: CodevProviderReadiness = providerIssue ? 'blocked' : 'ready'
  if (view.session.state === 'running') {
    return {
      state: 'working',
      label: 'Working',
      detail: view.activeTurnAuthorName
        ? `${view.activeTurnAuthorName} is running a turn.`
        : 'Running a CoDev turn.',
      providerReadiness,
      providerIssue
    }
  }
  if (view.session.state === 'waiting') {
    return {
      state: 'waiting',
      label: 'Waiting',
      detail:
        view.session.queue.length > 0
          ? 'Queued instructions are waiting for the provider.'
          : 'Waiting for an instruction.',
      providerReadiness,
      providerIssue
    }
  }
  if (view.session.state === 'interrupted') {
    return {
      state: 'paused',
      label: 'Paused',
      detail: 'The last turn was paused. Review the conversation before continuing.',
      providerReadiness,
      providerIssue
    }
  }
  if (view.session.state === 'failed') {
    return {
      state: 'failed',
      label: 'Failed',
      detail: providerIssue ?? 'The agent session failed. Retry or inspect the branch.',
      providerReadiness,
      providerIssue
    }
  }
  if (view.session.state === 'completed') {
    return {
      state: 'stopped',
      label: 'Stopped',
      detail: 'The agent session is stopped. Its branch remains available for inspection.',
      providerReadiness,
      providerIssue
    }
  }
  return {
    state: 'starting',
    label: 'Starting',
    detail: 'The agent session is preparing its first turn.',
    providerReadiness,
    providerIssue
  }
}

export function activeManagedSession(view: CodevSharedSessionView): boolean {
  return view.worktreeStatus === 'active' || view.worktreeStatus === 'frozen'
}
