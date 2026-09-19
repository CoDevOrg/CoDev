/* eslint-disable max-lines -- The Mission Control container keeps polling, merge, and stop actions together so the live-room lifecycle is auditable in one place. */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useActiveWorktree, useAllWorktrees } from '@/store/selectors'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import {
  getCodevBridgeSnapshot,
  getCodevWorkspaceStreamStatus,
  requestCodevBridge,
  subscribeCodevBridge,
  subscribeCodevWorkspaceEvent,
  subscribeCodevWorkspaceStream
} from '../../web/codev-bridge-singleton'
import type { CodevWorkspaceStreamStatus } from '../../web/codev-bridge-singleton'
import { describeAgentStopPlan, planAgentStop } from '../../web/codev-agent-stop-plan'
import { consumeCodevSurfaceFocus, useCodevSurfaceFocus } from '../../web/codev-surface-focus'
import { setCodevAgentSelection, setCodevBranchSelection } from '../codev/codev-branches-view'
import { codevBranchLabel, findCodevWorktreeForManagedId } from '../codev/codev-branches-model'
import { CodevMissionControlView } from './CodevMissionControlView'
import type { CodevSharedSessionView } from './codev-shared-session-model'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { Worktree } from '../../../../shared/types'
import type { CodevWorkboardSnapshot } from '../sidebar/CodevWorkboardView'
import { reconcileCodevStatus } from '../codev/codev-status-model'
import {
  attachMissionControlHolds,
  EMPTY_MISSION_CONTROL_COORDINATION,
  distinctLocalAgentEntries,
  mergeMissionControlAgents,
  missionControlPhaseFromState,
  summarizeAgentActivity,
  type MissionControlPermissions,
  type MissionControlAgent,
  type MissionControlCoordination,
  type MissionControlFeedHealth,
  type MissionControlPendingAction,
  type MissionControlSlotUsage
} from './codev-mission-control-model'
import {
  localAgentTabsWithoutStatus,
  resolveLocalStatusAgent,
  resolveLocalTabAgent,
  tabIdFromPaneKey,
  type MissionControlTab
} from './codev-local-agent-tabs'

/**
 * Mission Control container.
 *
 * CoDev's premise is several people steering several agents against one
 * repository, and until now that was only legible by opening a panel and
 * reading a status string. This is the workspace's default right-sidebar tab,
 * so the state of the room is on screen while you work.
 *
 * The panel has one source of truth: `workboard.list` over the CoDev bridge.
 * Orca remains the editor and review shell, but its native PTY agent rows are
 * intentionally not treated as CoDev agents.
 *  - `coordination.list` over the same bridge — the workspace's live path
 *    claims and brain overlaps. The panel used to decide an agent was "blocked
 *    on a file claim" by regex over its status text and then describe the
 *    claim mechanism to the user on that basis; these are the rows the agents
 *    actually write.
 */

const FALLBACK_REFRESH_MS = 15_000
const TICK_MS = 1_000

type SharedSessionSnapshot = {
  viewer?: { id?: string; name?: string; canCoSteer?: boolean }
  sharedSessions?: CodevSharedSessionView[]
}

/** Stable per-name hue so a person keeps one colour across the panel. */
function hueFor(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 360
  }
  return hash
}

function providerLabel(raw: string): string {
  const value = raw.toLowerCase()
  if (value.includes('claude') || value.includes('anthropic')) {
    return 'Claude'
  }
  if (value.includes('codex') || value.includes('openai')) {
    return 'Codex'
  }
  if (value.includes('cursor')) {
    return 'Cursor'
  }
  if (!raw) {
    return 'Agent'
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

/**
 * Removing the active worktree leaves `activeWorktreeId: null` and nothing
 * picks a replacement — fine on the desktop's worktree list, a blank pane in
 * the embed where the chat *is* the workspace. Prefer a worktree another agent
 * is still in.
 */
function settleOnSurvivingWorktree(removedWorktreeId: string, preferred: string[]): void {
  const state = useAppStore.getState()
  if (state.activeWorktreeId) {
    return
  }
  const survivors = (state.allWorktrees?.() ?? []).filter(
    (entry: { id: string }) => entry.id !== removedWorktreeId
  )
  const target =
    survivors.find((entry: { id: string }) => preferred.includes(entry.id)) ?? survivors[0]
  if (target) {
    activateAndRevealWorktree(target.id, { revealInSidebar: true })
  }
}

/** A worktree CoDev made for an agent, as opposed to the workspace's own. */
function isReleasableWorktree(worktreeId: string): boolean {
  // Managed CoDev sessions are stopped through the backend session id. Orca
  // never releases a sandbox worktree directly because the two filesystems do
  // not share lifecycle ownership.
  void worktreeId
  return false
}

function parseActivityTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function statusActivity(session: CodevSharedSessionView): string {
  if (session.connectionBlocked) {
    return session.connectionBlocked
  }
  if (session.session.state === 'failed') {
    return session.lastError ?? 'The agent session failed. Retry or inspect the branch.'
  }
  if (session.session.state === 'interrupted') {
    return 'The last turn was paused. Review the conversation before continuing.'
  }
  if (session.session.state === 'running') {
    return session.activeTurnAuthorName
      ? `${session.activeTurnAuthorName} is running a turn.`
      : 'Running a CoDev turn.'
  }
  const queue = session.attributedQueue ?? session.session.queue
  if (queue.length > 0) {
    return `${queue.length === 1 ? 'Instruction' : 'Instructions'} queued.`
  }
  if (session.lastCompletedAction) {
    return `Last action: ${session.lastCompletedAction.tool}.`
  }
  if (session.transcript.length > 0) {
    return `${session.transcript.length} completed ${session.transcript.length === 1 ? 'turn' : 'turns'}.`
  }
  return 'Waiting for an instruction.'
}

function managedPermissions(
  session: CodevSharedSessionView,
  canCoSteer: boolean,
  localWorktreeId: string | null
): MissionControlPermissions {
  const providerCanQueue = session.capabilities?.canQueue ?? true
  const providerCanInterrupt = session.capabilities?.canInterrupt ?? true
  const providerIssue =
    session.connectionBlocked ??
    (session.session.state === 'failed' ? (session.lastError ?? 'The agent session failed.') : null)
  const canSteer = canCoSteer && providerCanQueue && !providerIssue
  const canPause = canCoSteer && providerCanInterrupt && !providerIssue
  return {
    canView: true,
    canSteer,
    canPause,
    canEdit: localWorktreeId !== null,
    canPublish: localWorktreeId !== null,
    canStop: canCoSteer,
    ...(canSteer
      ? {}
      : {
          steerReason: !canCoSteer
            ? 'Co-steer permission is required to send instructions.'
            : (providerIssue ??
              session.capabilities?.queueUnavailable ??
              'This provider cannot queue instructions.')
        }),
    ...(canPause
      ? {}
      : {
          pauseReason: !canCoSteer
            ? 'Co-steer permission is required to pause this agent.'
            : (providerIssue ??
              session.capabilities?.interruptUnavailable ??
              'This provider cannot pause turns.')
        }),
    ...(localWorktreeId
      ? {
          publishReason: 'Review and publish this branch from Source Control.'
        }
      : {
          editReason: 'The local branch workspace is still being prepared.',
          publishReason: 'Wait for the local branch workspace before publishing.'
        }),
    ...(canCoSteer
      ? {}
      : { stopReason: 'Co-steer permission is required to stop a managed session.' })
  }
}

function localPermissions(
  worktreeId: string | null,
  tabId: string | null
): MissionControlPermissions {
  return {
    canView: true,
    canSteer: false,
    canPause: false,
    canEdit: worktreeId !== null,
    canPublish: worktreeId !== null,
    canStop: tabId !== null,
    steerReason: 'Open this chat to steer your agent directly.',
    pauseReason: 'Open this chat to control the agent directly.',
    ...(worktreeId
      ? { publishReason: 'Review and publish this branch from Source Control.' }
      : { editReason: 'The branch workspace is not available.' }),
    ...(tabId ? {} : { stopReason: 'This chat does not have a closable tab.' })
  }
}

function toManagedAgent(
  session: CodevSharedSessionView,
  canCoSteer: boolean,
  worktrees: readonly Worktree[]
): MissionControlAgent {
  const localWorktree = findCodevWorktreeForManagedId(worktrees, session.session.worktreeId)
  const agentName = session.name.trim() || 'Agent session'
  return {
    key: `managed:${session.session.sessionId}`,
    origin: 'managed',
    sessionId: session.session.sessionId,
    worktreeId: localWorktree?.id ?? null,
    tabId: null,
    branch: localWorktree?.branch ?? null,
    ownerName: session.ownerName.trim() || 'Teammate',
    ownerHue: hueFor(session.ownerName.trim() || session.session.sessionId),
    providerLabel: providerLabel(session.session.provider),
    model: session.model || session.session.model || null,
    phase: missionControlPhaseFromState(session.session.state),
    title: agentName,
    agentName,
    activity: statusActivity(session),
    startedAt: null,
    serverElapsed: null,
    lastActivityAt: parseActivityTimestamp(session.lastActivityAt),
    canSteer: managedPermissions(session, canCoSteer, localWorktree?.id ?? null).canSteer,
    permissions: managedPermissions(session, canCoSteer, localWorktree?.id ?? null),
    conversation: session,
    holds: []
  }
}

function worktreeForTab(
  tabId: string | null,
  tabsByWorktree: Readonly<Record<string, readonly MissionControlTab[]>>
): string | null {
  if (!tabId) {
    return null
  }
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    if (tabs.some((tab) => tab.id === tabId)) {
      return worktreeId
    }
  }
  return null
}

function localAgent(
  entry: AgentStatusEntry,
  paneKey: string,
  worktreeId: string,
  worktree: Worktree | undefined,
  tabId: string | null
): MissionControlAgent {
  const provider = resolveLocalStatusAgent(entry.agentType, entry.terminalTitle, entry.prompt)
  const activity = entry.toolName
    ? `${entry.toolName}${entry.toolInput ? ` · ${entry.toolInput}` : ''}`
    : entry.lastAssistantMessage?.trim() ||
      `${entry.state[0]?.toUpperCase() ?? ''}${entry.state.slice(1)}.`
  const title = entry.prompt.trim() || entry.terminalTitle?.trim() || `${provider} chat`
  const permissions = localPermissions(worktreeId, tabId)
  return {
    key: `local:${paneKey}`,
    origin: 'you',
    sessionId: null,
    worktreeId,
    tabId,
    branch: worktree?.branch ?? null,
    ownerName: 'You',
    ownerHue: hueFor('You'),
    providerLabel: providerLabel(provider),
    model: entry.model ?? null,
    phase: missionControlPhaseFromState(entry.state),
    title,
    agentName: providerLabel(provider),
    activity,
    startedAt: entry.stateStartedAt || null,
    serverElapsed: null,
    lastActivityAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : null,
    canSteer: false,
    permissions,
    conversation: null,
    holds: []
  }
}

function buildLocalAgents(
  agentStatusByPaneKey: Readonly<Record<string, AgentStatusEntry>>,
  tabsByWorktree: Readonly<Record<string, readonly MissionControlTab[]>>,
  worktrees: readonly Worktree[],
  fallbackAgent: string
): MissionControlAgent[] {
  const worktreeById = new Map(worktrees.map((worktree) => [worktree.id, worktree]))
  const statusEntries = distinctLocalAgentEntries(
    Object.entries(agentStatusByPaneKey)
      .filter(([, entry]) => Boolean(entry.agentType))
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
  )
  const local = statusEntries.flatMap(([paneKey, entry]) => {
    const tabId = entry.tabId ?? tabIdFromPaneKey(paneKey)
    const worktreeId = entry.worktreeId ?? worktreeForTab(tabId, tabsByWorktree)
    if (!worktreeId) {
      return []
    }
    return [localAgent(entry, paneKey, worktreeId, worktreeById.get(worktreeId), tabId)]
  })

  const statusByPaneKey = Object.fromEntries(
    Object.entries(agentStatusByPaneKey).map(([paneKey, entry]) => [
      paneKey,
      { agentType: entry.agentType }
    ])
  )
  const tabsWithoutStatus = localAgentTabsWithoutStatus(tabsByWorktree, statusByPaneKey)
  for (const { worktreeId, tab } of tabsWithoutStatus) {
    const provider = resolveLocalTabAgent(tab, fallbackAgent)
    const permissions = localPermissions(worktreeId, tab.id)
    local.push({
      key: `local:tab:${tab.id}`,
      origin: 'you',
      sessionId: null,
      worktreeId,
      tabId: tab.id,
      branch: worktreeById.get(worktreeId)?.branch ?? null,
      ownerName: 'You',
      ownerHue: hueFor('You'),
      providerLabel: providerLabel(provider),
      model: null,
      phase: 'waiting',
      title: tab.generatedTitle?.trim() || tab.title?.trim() || `${provider} chat`,
      agentName: providerLabel(provider),
      activity: 'Ready in your chat.',
      startedAt: null,
      serverElapsed: null,
      lastActivityAt: Number.isFinite(tab.createdAt ?? 0) ? (tab.createdAt ?? null) : null,
      canSteer: false,
      permissions,
      conversation: null,
      holds: []
    })
  }
  return local
}

export function CodevLiveAgentsPanel(): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
  const activeWorktree = useActiveWorktree()
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const allWorktrees = useAllWorktrees()
  const agentStatusByPaneKey = useAppStore((state) => state.agentStatusByPaneKey)
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const fallbackAgent =
    typeof window !== 'undefined' && window.__CODEV_DEFAULT_AGENT__
      ? window.__CODEV_DEFAULT_AGENT__
      : 'claude'
  const [now, setNow] = useState(() => Date.now())
  const [bridgeStatus, setBridgeStatus] = useState<string>(() =>
    typeof window === 'undefined' ? 'disconnected' : getCodevBridgeSnapshot().status
  )
  const [workspaceStreamStatus, setWorkspaceStreamStatus] = useState<CodevWorkspaceStreamStatus>(
    () => (typeof window === 'undefined' ? 'unavailable' : getCodevWorkspaceStreamStatus())
  )
  const [sharedSessions, setSharedSessions] = useState<CodevSharedSessionView[]>([])
  const [workboardSnapshot, setWorkboardSnapshot] = useState<CodevWorkboardSnapshot | null>(null)
  const [coordination, setCoordination] = useState<MissionControlCoordination>(
    EMPTY_MISSION_CONTROL_COORDINATION
  )
  const [workboardCanCoSteer, setWorkboardCanCoSteer] = useState(false)
  const [sharedCanCoSteer, setSharedCanCoSteer] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  // One lifecycle request per agent at a time; the drawer shows which.
  const [pending, setPending] = useState<{
    key: string
    action: MissionControlPendingAction
  } | null>(null)
  // Each feed remembers its first failure after a good snapshot, so the
  // panel can say the data is old instead of presenting it as live.
  const [feedFailures, setFeedFailures] = useState<{
    workboard: { at: number; message: string } | null
    sessions: { at: number; message: string } | null
    coordination: { at: number; message: string } | null
  }>({ workboard: null, sessions: null, coordination: null })
  const hadWorkboardRef = useRef(false)
  const hadSessionsRef = useRef(false)
  const hadCoordinationRef = useRef(false)
  const managedRefreshInFlightRef = useRef(false)
  const coordinationRefreshInFlightRef = useRef(false)

  useEffect(
    () =>
      subscribeCodevBridge(() => {
        setBridgeStatus(getCodevBridgeSnapshot().status)
      }),
    []
  )

  const refreshManaged = useCallback(async () => {
    if (bridgeStatus !== 'connected') {
      return
    }
    if (managedRefreshInFlightRef.current) {
      return
    }
    managedRefreshInFlightRef.current = true
    try {
      try {
        const snapshot = await requestCodevBridge<CodevWorkboardSnapshot>('workboard.list')
        setWorkboardSnapshot(snapshot)
        setWorkboardCanCoSteer(Boolean(snapshot?.viewer?.canCoSteer))
        hadWorkboardRef.current = true
        setFeedFailures((current) =>
          current.workboard ? { ...current, workboard: null } : current
        )
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        setFeedFailures((current) => ({
          ...current,
          workboard: current.workboard ?? { at: Date.now(), message }
        }))
      }

      try {
        const snapshot = await requestCodevBridge<SharedSessionSnapshot>('agents.list')
        setSharedCanCoSteer(Boolean(snapshot?.viewer?.canCoSteer))
        setSharedSessions(snapshot?.sharedSessions ?? [])
        hadSessionsRef.current = true
        setFeedFailures((current) => (current.sessions ? { ...current, sessions: null } : current))
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        setFeedFailures((current) => ({
          ...current,
          sessions: current.sessions ?? { at: Date.now(), message }
        }))
      }
    } catch (error: unknown) {
      // The individual feeds above own their stale-state handling. This guard
      // only protects the polling loop from an unexpected projection error.
      const message = error instanceof Error ? error.message : String(error)
      setFeedFailures((current) => ({
        ...current,
        sessions: current.sessions ?? { at: Date.now(), message }
      }))
    } finally {
      managedRefreshInFlightRef.current = false
    }
  }, [bridgeStatus])

  const refreshCoordination = useCallback(async () => {
    if (bridgeStatus !== 'connected') {
      return
    }
    if (coordinationRefreshInFlightRef.current) {
      return
    }
    coordinationRefreshInFlightRef.current = true
    try {
      const snapshot = await requestCodevBridge<MissionControlCoordination>('coordination.list')
      setCoordination({
        claims: snapshot?.claims ?? [],
        contests: snapshot?.contests ?? [],
        overlaps: snapshot?.overlaps ?? []
      })
      hadCoordinationRef.current = true
      setFeedFailures((current) =>
        current.coordination ? { ...current, coordination: null } : current
      )
    } catch (error: unknown) {
      // Keep the last snapshot rather than blanking the holds on one bad poll;
      // the interval retries. An older claim set is closer to the truth than
      // asserting nobody holds anything — as long as it is labelled old.
      if (hadCoordinationRef.current) {
        const message = error instanceof Error ? error.message : String(error)
        setFeedFailures((current) => ({
          ...current,
          coordination: current.coordination ?? { at: Date.now(), message }
        }))
      }
    } finally {
      coordinationRefreshInFlightRef.current = false
    }
  }, [bridgeStatus])

  useEffect(() => {
    const unsubscribeEvent = subscribeCodevWorkspaceEvent((event) => {
      if (event.type === 'agents.changed') {
        void refreshManaged()
      } else if (event.type === 'coordination.changed') {
        void refreshCoordination()
      }
    })
    const unsubscribeStream = subscribeCodevWorkspaceStream(setWorkspaceStreamStatus)
    return () => {
      unsubscribeEvent()
      unsubscribeStream()
    }
  }, [refreshCoordination, refreshManaged])

  const reconciled = useMemo(
    () =>
      reconcileCodevStatus({
        bridge: bridgeStatus as 'connected' | 'reconnecting' | 'disconnected',
        workboard: {
          value: workboardSnapshot,
          loaded: workboardSnapshot !== null,
          error: feedFailures.workboard?.message ?? null,
          hadSuccessfulSnapshot: workboardSnapshot !== null,
          failedAt: feedFailures.workboard?.at ?? null
        },
        sessions: {
          value: sharedSessions,
          loaded: hadSessionsRef.current,
          error: feedFailures.sessions?.message ?? null,
          hadSuccessfulSnapshot: hadSessionsRef.current,
          failedAt: feedFailures.sessions?.at ?? null
        }
      }),
    [bridgeStatus, feedFailures, sharedSessions, workboardSnapshot]
  )

  const feed = useMemo<MissionControlFeedHealth>(() => {
    const base = reconciled.feed
    if (feedFailures.coordination) {
      return {
        phase: hadCoordinationRef.current ? 'stale' : 'failed',
        staleSince: feedFailures.coordination.at,
        message: feedFailures.coordination.message
      }
    }
    return {
      ...base,
      phase:
        base.phase === 'live'
          ? 'live'
          : base.phase === 'reconciling'
            ? 'reconciling'
            : base.phase === 'reconnecting'
              ? 'reconnecting'
              : base.phase === 'failed'
                ? 'failed'
                : 'stale'
    }
  }, [feedFailures.coordination, reconciled])

  const visibleSlots = useMemo<MissionControlSlotUsage | null>(() => {
    if (reconciled.slots) {
      return { ...reconciled.slots, state: 'live' }
    }
    if (reconciled.feed.phase === 'reconciling') {
      return { used: 0, total: 0, state: 'reconciling' }
    }
    return null
  }, [reconciled])

  const retryFeeds = useCallback(() => {
    void refreshManaged()
    void refreshCoordination()
  }, [refreshManaged, refreshCoordination])

  useEffect(() => {
    if (!embedded) {
      return
    }
    void refreshManaged()
    void refreshCoordination()
    if (workspaceStreamStatus === 'connected') {
      return
    }
    const timer = setInterval(() => {
      void refreshManaged()
      void refreshCoordination()
    }, FALLBACK_REFRESH_MS)
    return () => clearInterval(timer)
  }, [embedded, refreshManaged, refreshCoordination, workspaceStreamStatus])

  const canCoSteer = workboardCanCoSteer || sharedCanCoSteer

  const managed = useMemo(
    () => sharedSessions.map((session) => toManagedAgent(session, canCoSteer, allWorktrees)),
    [allWorktrees, canCoSteer, sharedSessions]
  )
  const local = useMemo(
    () => buildLocalAgents(agentStatusByPaneKey, tabsByWorktree, allWorktrees, fallbackAgent),
    [agentStatusByPaneKey, allWorktrees, fallbackAgent, tabsByWorktree]
  )
  const workspaceAgents = useMemo(() => mergeMissionControlAgents(managed, local), [local, managed])
  const branchAgents = useMemo(
    () => workspaceAgents.filter((agent) => agent.worktreeId === activeWorktreeId),
    [activeWorktreeId, workspaceAgents]
  )
  const branchCoordination = useMemo(() => {
    if (!activeWorktreeId) {
      return EMPTY_MISSION_CONTROL_COORDINATION
    }
    const sessionIds = new Set(
      branchAgents
        .map((agent) => agent.sessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId))
    )
    const claims = coordination.claims.filter(
      (claim) => sessionIds.has(claim.sessionId) || claim.worktreeId === activeWorktreeId
    )
    return {
      claims,
      contests: coordination.contests.filter((contest) =>
        contest.holders.some((holder) => sessionIds.has(holder.sessionId))
      ),
      overlaps: coordination.overlaps.filter((overlap) =>
        overlap.sessionIds.some((sessionId) => sessionIds.has(sessionId))
      )
    }
  }, [activeWorktreeId, branchAgents, coordination])
  const agents = useMemo(
    () => attachMissionControlHolds(branchAgents, branchCoordination),
    [branchAgents, branchCoordination]
  )

  const activity = useMemo(() => summarizeAgentActivity(workspaceAgents), [workspaceAgents])

  // The workboard only knows managed sessions, so the bar needs this merged
  // figure. Report the split, not a total: the list includes open-but-idle
  // tabs. `count` stays on the wire for a parent on an older bundle.
  useEffect(() => {
    if (!embedded || typeof window === 'undefined' || window.parent === window) {
      return
    }
    window.parent.postMessage(
      {
        type: 'codev:agent-count',
        active: activity.active,
        idle: activity.idle,
        count: activity.total,
        // Slots are a different number from agents, and the top bar used to
        // print the agent count over a slot denominator.
        ...(visibleSlots?.state === 'live'
          ? { slotsUsed: visibleSlots.used, slotsTotal: visibleSlots.total }
          : {})
      },
      window.location.origin
    )
  }, [activity, embedded, visibleSlots])

  const busy = activity.active > 0

  useEffect(() => {
    if (!busy) {
      return
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [busy])

  const byKey = useCallback(
    (key: string) => agents.find((agent) => agent.key === key) ?? null,
    [agents]
  )

  const branchLabel = activeWorktree ? codevBranchLabel(activeWorktree, null) : 'Selected branch'

  useEffect(() => {
    const requestedAgent = typeof window !== 'undefined' ? window.__CODEV_AGENT__?.trim() : ''
    const requestedBranch = typeof window !== 'undefined' ? window.__CODEV_BRANCH__?.trim() : ''
    const activeBranch = activeWorktree?.branch.trim().replace(/^refs\/heads\//, '') ?? ''
    if (
      !requestedAgent ||
      !activeWorktreeId ||
      (requestedBranch && activeBranch !== requestedBranch.replace(/^refs\/heads\//, ''))
    ) {
      return
    }
    const key = `managed:${requestedAgent}`
    if (agents.some((agent) => agent.key === key)) {
      setOpenKey(key)
    }
  }, [activeWorktree?.branch, activeWorktreeId, agents])

  useEffect(() => {
    if (openKey && !agents.some((agent) => agent.key === openKey)) {
      setOpenKey(null)
      setCodevAgentSelection(null)
    }
  }, [agents, openKey])

  // An activity jump names a session; open its drawer once the row is here.
  // Until the first workboard snapshot lands the row may simply not have
  // arrived, so "not running" is only concluded after that.
  const focus = useCodevSurfaceFocus('mission-control-agent')
  useEffect(() => {
    if (!focus) {
      return
    }
    const key = `managed:${focus.target.sessionId}`
    if (agents.some((agent) => agent.key === key)) {
      setOpenKey(key)
      consumeCodevSurfaceFocus(focus.id)
      return
    }
    if (hadSessionsRef.current) {
      toast.message('That agent session is no longer running.')
      consumeCodevSurfaceFocus(focus.id)
    }
  }, [agents, focus, sharedSessions])

  // The confirmation the drawer shows is the plan Stop will run, not a
  // generic promise about slots.
  const stopDescription = useMemo(() => {
    if (!openKey) {
      return null
    }
    const agent = byKey(openKey)
    if (!agent) {
      return null
    }
    if (!agent.permissions.canStop) {
      return {
        allowed: false,
        button: 'Stop agent',
        detail: agent.permissions.stopReason ?? 'You do not have permission to stop this agent.'
      }
    }
    return describeAgentStopPlan(planAgentStop(openKey, agents, isReleasableWorktree))
  }, [agents, byKey, openKey])
  const pendingAction = pending && pending.key === openKey ? pending.action : null

  /** Open the agent's own chat, its branch workspace, or its conversation. */
  const handleStepIn = useCallback(
    (key: string) => {
      const agent = byKey(key)
      if (!agent) {
        return
      }
      if (agent.tabId && agent.worktreeId) {
        const activated = activateAndRevealWorktree(agent.worktreeId, { revealInSidebar: true })
        if (!activated) {
          toast.error('Could not open this agent chat', {
            description: 'The branch workspace is no longer available.'
          })
          return
        }
        const state = useAppStore.getState()
        if (!(state.tabsByWorktree[agent.worktreeId] ?? []).some((tab) => tab.id === agent.tabId)) {
          toast.error('Could not open this agent chat', {
            description: 'The chat tab is no longer available.'
          })
          return
        }
        state.setActiveTabForWorktree(agent.worktreeId, agent.tabId)
        if (state.activeWorktreeId === agent.worktreeId) {
          state.setActiveTab(agent.tabId)
        }
        if (agent.branch) {
          setCodevBranchSelection(agent.branch)
        }
        setCodevAgentSelection(null)
        setOpenKey(null)
        return
      }
      if (agent.worktreeId) {
        const activated = activateAndRevealWorktree(agent.worktreeId, { revealInSidebar: true })
        if (!activated) {
          toast.error('Could not open this branch', {
            description: 'The local worktree is no longer available.'
          })
          return
        }
        if (agent.branch) {
          setCodevBranchSelection(agent.branch)
        }
        setCodevAgentSelection(null)
        setOpenKey(null)
        return
      }
      if (agent.conversation && agent.sessionId) {
        setCodevAgentSelection(agent.sessionId)
        setOpenKey(agent.key)
        return
      }
      toast.message('This agent’s branch is still being prepared. Its status is shown here.')
    },
    [byKey]
  )

  const handleOpen = useCallback(
    (key: string) => {
      const agent = byKey(key)
      if (!agent) {
        return
      }
      setOpenKey(key)
      if (agent.sessionId) {
        setCodevAgentSelection(agent.sessionId)
      } else {
        setCodevAgentSelection(null)
      }
    },
    [byKey]
  )

  const handleClose = useCallback(() => {
    setOpenKey(null)
    setCodevAgentSelection(null)
  }, [])

  /** Resolves true once the host queued the instruction; false keeps the draft. */
  const handleSteer = useCallback(
    async (key: string, text: string): Promise<boolean> => {
      const agent = byKey(key)
      const prompt = text.trim()
      if (!agent?.sessionId || !agent.permissions.canSteer || !prompt || pending) {
        return false
      }
      setPending({ key, action: 'steer' })
      try {
        await requestCodevBridge('agents.enqueue', { sessionId: agent.sessionId, prompt })
        toast.success(`Steer queued for ${agent.ownerName}'s agent`)
        void refreshManaged()
        return true
      } catch (error: unknown) {
        toast.error('Could not steer this agent', {
          description: error instanceof Error ? error.message : String(error)
        })
        return false
      } finally {
        setPending(null)
      }
    },
    [byKey, pending, refreshManaged]
  )

  const handlePause = useCallback(
    async (key: string) => {
      const agent = byKey(key)
      if (!agent?.sessionId || !agent.permissions.canPause || pending) {
        return
      }
      setPending({ key, action: 'pause' })
      try {
        await requestCodevBridge('agents.interrupt', { sessionId: agent.sessionId })
        toast.success('Asked the agent to pause after this step')
        void refreshManaged()
      } catch (error: unknown) {
        toast.error('Could not pause this agent', {
          description: error instanceof Error ? error.message : String(error)
        })
      } finally {
        setPending(null)
      }
    },
    [byKey, pending, refreshManaged]
  )

  /**
   * Stop is per-agent, not per-worktree: several agents legitimately share one
   * checkout, so releasing it for any one of them stopped all of them. The
   * checkout goes only for the last agent out of a worktree CoDev made for it
   * — never the workspace's own root, which a repo-less workspace's agents run
   * in directly. Releasing is also the only case that frees a slot, since
   * capacity counts worktrees. The branch is kept either way.
   */
  const handleStop = useCallback(
    async (key: string) => {
      const agent = byKey(key)
      if (pending || !agent?.permissions.canStop) {
        return
      }
      const plan = planAgentStop(key, agents, isReleasableWorktree)
      setPending({ key, action: 'stop' })
      try {
        if (plan.kind === 'discard-session') {
          const result = await requestCodevBridge<{ status?: string }>('agents.discard', {
            sessionId: plan.sessionId
          })
          setOpenKey(null)
          toast.success('Agent stopped', {
            description:
              // The host stops the session only when siblings still hold the worktree.
              result?.status === 'stopped'
                ? 'Its branch is kept, and the worktree stays for the other agents in it.'
                : 'Its slot is free and its branch is kept.'
          })
          void refreshManaged()
          return
        }
        if (plan.kind === 'unsupported' || plan.kind === 'close-tab') {
          toast.error('This agent cannot be stopped from here.')
          return
        }
        const result = await useAppStore.getState().removeWorktree(plan.worktreeId)
        if (!result.ok) {
          toast.error('Could not stop this agent', { description: result.error })
          return
        }
        settleOnSurvivingWorktree(plan.worktreeId, plan.survivorWorktreeIds)
        setOpenKey(null)
        toast.success('Agent stopped', { description: 'Its slot is free and its branch is kept.' })
        void refreshManaged()
      } catch (error: unknown) {
        toast.error('Could not stop this agent', {
          description: error instanceof Error ? error.message : String(error)
        })
      } finally {
        setPending(null)
      }
    },
    [agents, byKey, pending, refreshManaged]
  )

  if (!embedded) {
    return null
  }

  return (
    <div className="codev-agents-panel">
      <CodevMissionControlView
        agents={agents}
        branchLabel={branchLabel}
        coordination={branchCoordination}
        now={now}
        openKey={openKey}
        pendingAction={pendingAction}
        slots={visibleSlots}
        feed={feed}
        stopDescription={stopDescription}
        onRetryFeed={retryFeeds}
        onOpen={handleOpen}
        onClose={handleClose}
        onStepIn={handleStepIn}
        onSteer={handleSteer}
        onPause={handlePause}
        onStop={(key) => void handleStop(key)}
      />
    </div>
  )
}
