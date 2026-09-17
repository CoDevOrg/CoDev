/* eslint-disable max-lines -- Branch projection rules stay together so state labels remain deterministic. */

import type { AgentStatusState } from '../../../../shared/agent-status-types'
import type { Worktree } from '../../../../shared/types'
import type { CodevWorkboardSlot } from '../sidebar/CodevWorkboardView'
import { getCodevProposalWorktreeId } from '../../web/codev-proposal-discard'
import type { CodevSharedSessionView } from '../right-sidebar/codev-shared-session-model'
import { managedAgentStatus } from './codev-status-model'

export type CodevBranchState =
  | 'provisioning'
  | 'ready'
  | 'active'
  | 'syncing'
  | 'conflict'
  | 'failed'
  | 'paused'
  | 'disconnected'
  | 'stopped'

export type CodevBranchLocalActivity = {
  count: number
  providers: string[]
  status: AgentStatusState | 'starting' | null
  lastActivityAt: number
}

export type CodevBranchSummary = {
  id: string
  worktree: Worktree | null
  slot: CodevWorkboardSlot | null
  label: string
  /** The raw branch is retained for matching and diagnostics, not primary UI copy. */
  gitBranch: string
  owner: string
  agentCount: number
  provider: string | null
  agentStatus: string
  providerReady: boolean | null
  providerIssue: string | null
  statusDetail: string | null
  changedFiles: number | null
  lastActivityAt: number
  state: CodevBranchState
}

type BranchOwner = {
  name: string
  accessRole?: string
}

type LocalAgentEntry = {
  worktreeId?: string
  agentType?: string
  state: AgentStatusState
  updatedAt: number
  tabId?: string
  paneKey: string
}

type LocalAgentTab = {
  id: string
  launchAgent?: string
}

type BranchChangedSummary = {
  changedFiles?: number
  status?: string
}

type BranchModelInput = {
  worktrees: readonly Worktree[]
  slots: readonly CodevWorkboardSlot[]
  viewerName?: string | null
  owners?: readonly BranchOwner[]
  localActivity?: ReadonlyMap<string, CodevBranchLocalActivity>
  workingTreeEntriesByWorktree?: Readonly<Record<string, readonly { path: string }[] | undefined>>
  branchSummariesByWorktree?: Readonly<Record<string, BranchChangedSummary | null | undefined>>
  conflictOperationByWorktree?: Readonly<Record<string, string | undefined>>
  runtimeDisconnectedByWorktree?: Readonly<Record<string, boolean | undefined>>
  managedSessions?: readonly CodevSharedSessionView[]
  managedSessionsLoaded?: boolean
  statusReconciling?: boolean
}

const STATE_ORDER: Record<CodevBranchState, number> = {
  active: 0,
  provisioning: 1,
  conflict: 2,
  syncing: 3,
  failed: 4,
  paused: 5,
  disconnected: 6,
  ready: 7,
  stopped: 8
}

const GENERIC_ASSIGNMENTS = new Set([
  '',
  'available',
  'codex agent',
  'claude agent',
  'codev agent',
  'managed agent',
  'unassigned'
])

/** Generated branch names are implementation details, not useful navigation labels. */
export function isGeneratedCodevBranchName(value: string): boolean {
  return /^(?:codev-agent|codev)-[0-9a-f]{8}(?:-[0-9a-f-]{27,})?$/i.test(value.trim())
}

function meaningfulAssignment(value: string | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return GENERIC_ASSIGNMENTS.has(normalized.toLowerCase()) ? null : normalized
}

function slotForWorktree(
  worktree: Worktree,
  slots: readonly CodevWorkboardSlot[]
): CodevWorkboardSlot | null {
  const managedId = getCodevProposalWorktreeId(worktree.path, worktree.comment)
  return (
    slots.find(
      (slot) =>
        slot.occupied &&
        ((managedId !== null && slot.worktreeId === managedId) ||
          slot.worktreeId === worktree.id ||
          slot.worktree === worktree.branch)
    ) ?? null
  )
}

/**
 * Resolve a server-owned worktree to the local Orca representation without
 * guessing from a generated branch name. Managed worktrees carry the server
 * id in their comment or `.git/codev-agent-worktrees/<id>` path; the direct id
 * match keeps this safe for hosts that expose the server id as the local id.
 * Returning null for an ambiguous result is intentional: opening an unrelated
 * branch is worse than keeping the agent in its conversation view.
 */
export function findCodevWorktreeForManagedId(
  worktrees: readonly Worktree[],
  managedWorktreeId: string
): Worktree | null {
  const normalized = managedWorktreeId.trim()
  if (!normalized) {
    return null
  }
  const matches = worktrees.filter(
    (worktree) =>
      worktree.id === normalized ||
      getCodevProposalWorktreeId(worktree.path, worktree.comment) === normalized
  )
  return matches.length === 1 ? (matches[0] ?? null) : null
}

/** Resolve the one user-facing label shared by the overview and branch shell. */
export function codevBranchLabel(
  worktree: Worktree | null,
  slot: CodevWorkboardSlot | null
): string {
  if (!worktree) {
    return meaningfulAssignment(slot?.assignment) ?? 'Preparing branch'
  }

  const branch = worktree.branch?.trim() ?? ''
  if (worktree.isMainWorktree) {
    return branch || 'main'
  }
  if (!isGeneratedCodevBranchName(branch)) {
    return branch || worktree.displayName?.trim() || 'Branch'
  }

  return (
    meaningfulAssignment(slot?.assignment) ??
    (worktree.displayName?.trim() && !isGeneratedCodevBranchName(worktree.displayName)
      ? worktree.displayName.trim()
      : 'Agent workspace')
  )
}

function ownerForBranch(
  worktree: Worktree | null,
  slot: CodevWorkboardSlot | null,
  viewerName: string | null | undefined,
  owners: readonly BranchOwner[]
): string {
  const slotOwner = meaningfulAssignment(slot?.owner)
  if (worktree?.isMainWorktree) {
    return (
      owners.find((member) => member.accessRole === 'owner')?.name ||
      viewerName ||
      'Workspace owner'
    )
  }
  return slotOwner || 'Unassigned'
}

function preferredAgentStatus(
  local: CodevBranchLocalActivity | undefined,
  slot: CodevWorkboardSlot | null
): string {
  if (slot?.occupied) {
    return slot.status
  }
  if (local?.status === 'starting') {
    return 'Starting'
  }
  if (local?.status) {
    return local.status[0].toUpperCase() + local.status.slice(1)
  }
  return 'No agents'
}

function preferredProvider(
  local: CodevBranchLocalActivity | undefined,
  slot: CodevWorkboardSlot | null
): string | null {
  if (slot?.occupied && meaningfulAssignment(slot.provider)) {
    return slot.provider
  }
  return local?.providers[0] ?? null
}

function changedFileCount(
  worktreeId: string,
  workingTreeEntriesByWorktree: BranchModelInput['workingTreeEntriesByWorktree'],
  branchSummariesByWorktree: BranchModelInput['branchSummariesByWorktree']
): number | null {
  const summary = branchSummariesByWorktree?.[worktreeId]
  if (
    summary &&
    typeof summary.changedFiles === 'number' &&
    Number.isFinite(summary.changedFiles) &&
    summary.status !== 'loading'
  ) {
    return Math.max(0, Math.round(summary.changedFiles))
  }

  const entries = workingTreeEntriesByWorktree?.[worktreeId]
  if (entries === undefined) {
    return null
  }
  return new Set(entries.map((entry) => entry.path)).size
}

function branchState(args: {
  worktree: Worktree | null
  slot: CodevWorkboardSlot | null
  local: CodevBranchLocalActivity | undefined
  conflictOperation?: string
  runtimeDisconnected?: boolean
  managedSessions?: readonly CodevSharedSessionView[]
  statusReconciling?: boolean
}): CodevBranchState {
  if (!args.worktree) {
    return 'provisioning'
  }
  if (args.worktree.prunable) {
    return 'failed'
  }
  if (args.runtimeDisconnected) {
    return 'disconnected'
  }
  const managedStatuses = (args.managedSessions ?? []).map(managedAgentStatus)
  if (
    managedStatuses.some(
      (status) => status.state === 'failed' || status.providerReadiness === 'blocked'
    )
  ) {
    return 'failed'
  }
  if (managedStatuses.some((status) => status.state === 'paused')) {
    return 'paused'
  }
  if (
    managedStatuses.length > 0 &&
    managedStatuses.every((status) => status.state === 'stopped') &&
    !args.local
  ) {
    return 'stopped'
  }
  if (args.statusReconciling) {
    return 'syncing'
  }
  if (args.conflictOperation && args.conflictOperation !== 'unknown') {
    return 'conflict'
  }
  const slotStatus = args.slot?.status?.toLowerCase() ?? ''
  if (slotStatus === 'frozen') {
    return 'stopped'
  }
  if (slotStatus === 'interrupted') {
    return 'failed'
  }
  const localAgentActive =
    args.local?.status !== null && args.local?.status !== undefined && args.local.status !== 'done'
  if (args.slot?.occupied || localAgentActive) {
    return 'active'
  }
  if (args.worktree.locked) {
    return 'syncing'
  }
  return 'ready'
}

function latestActivity(
  worktree: Worktree | null,
  local: CodevBranchLocalActivity | undefined
): number {
  return Math.max(worktree?.lastActivityAt ?? 0, local?.lastActivityAt ?? 0)
}

export function buildCodevBranchLocalActivity(
  entries: readonly LocalAgentEntry[],
  tabsByWorktree: Readonly<Record<string, readonly LocalAgentTab[]>>
): ReadonlyMap<string, CodevBranchLocalActivity> {
  const working = new Map<
    string,
    {
      keys: Set<string>
      providers: Set<string>
      status: AgentStatusState | null
      lastActivityAt: number
    }
  >()
  const statusPriority: Record<AgentStatusState, number> = {
    working: 4,
    blocked: 3,
    waiting: 2,
    done: 1
  }

  for (const entry of entries) {
    if (!entry.worktreeId) {
      continue
    }
    const current = working.get(entry.worktreeId) ?? {
      keys: new Set<string>(),
      providers: new Set<string>(),
      status: null,
      lastActivityAt: 0
    }
    current.keys.add(entry.tabId ?? entry.paneKey)
    if (entry.agentType?.trim()) {
      current.providers.add(entry.agentType.trim())
    }
    if (!current.status || statusPriority[entry.state] > statusPriority[current.status]) {
      current.status = entry.state
    }
    current.lastActivityAt = Math.max(current.lastActivityAt, entry.updatedAt)
    working.set(entry.worktreeId, current)
  }

  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    const current = working.get(worktreeId) ?? {
      keys: new Set<string>(),
      providers: new Set<string>(),
      status: null,
      lastActivityAt: 0
    }
    for (const tab of tabs) {
      if (!tab.launchAgent || current.keys.has(tab.id)) {
        continue
      }
      current.keys.add(tab.id)
      current.providers.add(tab.launchAgent)
    }
    working.set(worktreeId, current)
  }

  const result = new Map<string, CodevBranchLocalActivity>()
  for (const [worktreeId, value] of working) {
    result.set(worktreeId, {
      count: value.keys.size,
      providers: [...value.providers],
      status: value.status ?? (value.keys.size > 0 ? 'starting' : null),
      lastActivityAt: value.lastActivityAt
    })
  }
  return result
}

export function buildCodevBranchSummaries({
  worktrees,
  slots,
  viewerName,
  owners = [],
  localActivity = new Map(),
  workingTreeEntriesByWorktree = {},
  branchSummariesByWorktree = {},
  conflictOperationByWorktree = {},
  runtimeDisconnectedByWorktree = {},
  managedSessions = [],
  managedSessionsLoaded = false,
  statusReconciling = false
}: BranchModelInput): CodevBranchSummary[] {
  const rows: CodevBranchSummary[] = []
  const matchedSlots = new Set<CodevWorkboardSlot>()

  for (const worktree of worktrees) {
    const slot = slotForWorktree(worktree, slots)
    if (slot) {
      matchedSlots.add(slot)
    }
    const local = localActivity.get(worktree.id)
    const proposalWorktreeId = getCodevProposalWorktreeId(worktree.path, worktree.comment)
    const managed = managedSessionsLoaded
      ? managedSessions.filter(
          (session) =>
            session.session.worktreeId === worktree.id ||
            session.session.worktreeId === proposalWorktreeId
        )
      : []
    const agentCount = managedSessionsLoaded
      ? managed.length + (local?.count ?? 0)
      : Math.max(slot?.occupied ? 1 : 0, local?.count ?? 0)
    const managedStatuses = managed.map((session) => ({
      session,
      status: managedAgentStatus(session)
    }))
    const status = managedStatuses[0]?.status ?? null
    const providerReady =
      managed.length > 0
        ? managedStatuses.every(({ status: next }) => next.providerReadiness === 'ready')
        : null
    const providerIssue =
      managedStatuses.find(({ status: next }) => next.providerIssue)?.status.providerIssue ?? null
    rows.push({
      id: worktree.id,
      worktree,
      slot,
      label: codevBranchLabel(worktree, slot),
      gitBranch: worktree.branch,
      owner: ownerForBranch(worktree, slot, viewerName, owners),
      agentCount,
      provider: managed[0]?.session.provider ?? preferredProvider(local, slot),
      agentStatus: status?.label ?? preferredAgentStatus(local, slot),
      providerReady,
      providerIssue,
      statusDetail: status?.detail ?? null,
      changedFiles: changedFileCount(
        worktree.id,
        workingTreeEntriesByWorktree,
        branchSummariesByWorktree
      ),
      lastActivityAt: latestActivity(worktree, local),
      state: branchState({
        worktree,
        slot,
        local,
        conflictOperation: conflictOperationByWorktree[worktree.id],
        runtimeDisconnected: runtimeDisconnectedByWorktree[worktree.id],
        managedSessions: managed,
        statusReconciling
      })
    })
  }

  for (const slot of slots) {
    if (!slot.occupied || matchedSlots.has(slot)) {
      continue
    }
    rows.push({
      id: `codev-slot:${slot.slot}`,
      worktree: null,
      slot,
      label: codevBranchLabel(null, slot),
      gitBranch: slot.worktree,
      owner: meaningfulAssignment(slot.owner) ?? 'Unassigned',
      agentCount: 1,
      provider: meaningfulAssignment(slot.provider),
      agentStatus: slot.status,
      providerReady: null,
      providerIssue: null,
      statusDetail: 'The branch is still being prepared.',
      changedFiles: null,
      lastActivityAt: 0,
      state: 'provisioning'
    })
  }

  return rows.sort((left, right) => {
    const leftMain = left.worktree?.isMainWorktree ? 0 : 1
    const rightMain = right.worktree?.isMainWorktree ? 0 : 1
    return (
      leftMain - rightMain ||
      STATE_ORDER[left.state] - STATE_ORDER[right.state] ||
      right.lastActivityAt - left.lastActivityAt ||
      left.label.localeCompare(right.label)
    )
  })
}
