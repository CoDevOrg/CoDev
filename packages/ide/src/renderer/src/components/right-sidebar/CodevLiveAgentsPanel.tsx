/* eslint-disable max-lines -- The Mission Control container keeps polling, merge, and stop actions together so the live-room lifecycle is auditable in one place. */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge
} from '../../web/codev-bridge-singleton'
import { describeAgentStopPlan, planAgentStop } from '../../web/codev-agent-stop-plan'
import { getCodevProposalWorktreeId } from '../../web/codev-proposal-discard'
import { consumeCodevSurfaceFocus, useCodevSurfaceFocus } from '../../web/codev-surface-focus'
import { CodevMissionControlView } from './CodevMissionControlView'
import {
  attachMissionControlHolds,
  EMPTY_MISSION_CONTROL_COORDINATION,
  mergeMissionControlAgents,
  missionControlPhaseFromStatus,
  summarizeAgentActivity,
  type MissionControlAgent,
  type MissionControlCoordination,
  type MissionControlFeedHealth,
  type MissionControlPendingAction,
  type MissionControlSlotUsage
} from './codev-mission-control-model'

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

const REFRESH_MS = 5_000
const TICK_MS = 1_000

type WorkboardSlot = {
  occupied?: boolean
  sessionId?: string | null
  worktreeId?: string | null
  assignment?: string
  owner?: string
  provider?: string
  status?: string
  currentTask?: string
  elapsed?: string
}

type WorkboardSnapshot = {
  viewer?: { id?: string; name?: string; canCoSteer?: boolean }
  slots?: WorkboardSlot[]
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

/** Map the backend sandbox id to the local Orca control/review worktree. */
function findOrcaWorktreeForManagedId(managedWorktreeId: string): string | null {
  const state = useAppStore.getState()
  for (const worktrees of Object.values(state.worktreesByRepo)) {
    for (const worktree of worktrees) {
      if (getCodevProposalWorktreeId(worktree.path, worktree.comment) === managedWorktreeId) {
        return worktree.id
      }
    }
  }
  return null
}

export function CodevLiveAgentsPanel(): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
  const [now, setNow] = useState(() => Date.now())
  const [bridgeStatus, setBridgeStatus] = useState<string>(() =>
    typeof window === 'undefined' ? 'disconnected' : getCodevBridgeSnapshot().status
  )
  const [managed, setManaged] = useState<MissionControlAgent[]>([])
  const [coordination, setCoordination] = useState<MissionControlCoordination>(
    EMPTY_MISSION_CONTROL_COORDINATION
  )
  const [canCoSteer, setCanCoSteer] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  // One lifecycle request per agent at a time; the drawer shows which.
  const [pending, setPending] = useState<{
    key: string
    action: MissionControlPendingAction
  } | null>(null)
  const [slots, setSlots] = useState<MissionControlSlotUsage | null>(null)
  // Each feed remembers its first failure after a good snapshot, so the
  // panel can say the data is old instead of presenting it as live.
  const [feedFailures, setFeedFailures] = useState<{
    workboard: { at: number; message: string } | null
    coordination: { at: number; message: string } | null
  }>({ workboard: null, coordination: null })
  const hadWorkboardRef = useRef(false)
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
      const snapshot = await requestCodevBridge<WorkboardSnapshot>('workboard.list')
      setCanCoSteer(Boolean(snapshot?.viewer?.canCoSteer))
      const slotRows = snapshot?.slots ?? []
      setSlots(
        slotRows.length > 0
          ? { used: slotRows.filter((slot) => slot.occupied).length, total: slotRows.length }
          : null
      )
      const rows = slotRows
        .filter((slot) => slot.occupied && slot.sessionId)
        .map<MissionControlAgent>((slot) => ({
          key: `managed:${slot.sessionId}`,
          origin: 'managed',
          sessionId: slot.sessionId ?? null,
          worktreeId: slot.worktreeId ? findOrcaWorktreeForManagedId(slot.worktreeId) : null,
          tabId: null,
          branch: null,
          ownerName: slot.owner?.trim() || 'Teammate',
          ownerHue: hueFor(slot.owner?.trim() || String(slot.sessionId)),
          providerLabel: providerLabel(String(slot.provider ?? '')),
          model: null,
          phase: missionControlPhaseFromStatus(String(slot.status ?? '')),
          title: slot.assignment?.trim() || 'Agent session',
          activity: slot.currentTask?.trim() || slot.status?.trim() || 'Working.',
          startedAt: null,
          serverElapsed: slot.elapsed?.trim() || null,
          canSteer: Boolean(snapshot?.viewer?.canCoSteer),
          holds: []
        }))
      setManaged(rows)
      hadWorkboardRef.current = true
      setFeedFailures((current) => (current.workboard ? { ...current, workboard: null } : current))
    } catch (error: unknown) {
      // Keep the last known managed set and label it stale; the interval
      // retries on its own so a stopped agent cannot silently look live.
      if (hadWorkboardRef.current) {
        const message = error instanceof Error ? error.message : String(error)
        setFeedFailures((current) => ({
          ...current,
          workboard: current.workboard ?? { at: Date.now(), message }
        }))
      }
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

  const feed = useMemo<MissionControlFeedHealth>(() => {
    const failures = [feedFailures.workboard, feedFailures.coordination].filter(
      (entry): entry is { at: number; message: string } => entry !== null
    )
    if (failures.length === 0) {
      return { staleSince: null, message: null }
    }
    const first = failures.reduce((oldest, entry) => (entry.at < oldest.at ? entry : oldest))
    return { staleSince: first.at, message: first.message }
  }, [feedFailures])

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
    const timer = setInterval(() => {
      void refreshManaged()
      void refreshCoordination()
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [embedded, refreshManaged, refreshCoordination])

  const agents = useMemo(
    () => attachMissionControlHolds(mergeMissionControlAgents(managed, []), coordination),
    [managed, coordination]
  )

  const activity = useMemo(() => summarizeAgentActivity(agents), [agents])

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
        ...(slots ? { slotsUsed: slots.used, slotsTotal: slots.total } : {})
      },
      window.location.origin
    )
  }, [activity, embedded, slots])

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
    if (hadWorkboardRef.current) {
      toast.message('That agent session is no longer running.')
      consumeCodevSurfaceFocus(focus.id)
    }
  }, [agents, focus, managed])

  // The confirmation the drawer shows is the plan Stop will run, not a
  // generic promise about slots.
  const stopDescription = useMemo(
    () =>
      openKey ? describeAgentStopPlan(planAgentStop(openKey, agents, isReleasableWorktree)) : null,
    [agents, openKey]
  )
  const pendingAction = pending && pending.key === openKey ? pending.action : null

  /** Step in reveals the Orca control/review worktree linked to the session. */
  const handleStepIn = useCallback(
    (key: string) => {
      const agent = byKey(key)
      if (!agent) {
        return
      }
      if (agent.worktreeId) {
        activateAndRevealWorktree(agent.worktreeId, { revealInSidebar: true })
        setOpenKey(null)
        return
      }
      toast.message('This agent has no open chat or worktree to step into.')
    },
    [byKey]
  )

  /** Resolves true once the host queued the instruction; false keeps the draft. */
  const handleSteer = useCallback(
    async (key: string, text: string): Promise<boolean> => {
      const agent = byKey(key)
      const prompt = text.trim()
      if (!agent?.sessionId || !prompt || pending) {
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
      if (!agent?.sessionId || pending) {
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
      if (pending) {
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
    [agents, pending, refreshManaged]
  )

  if (!embedded) {
    return null
  }

  return (
    <div className="codev-agents-panel">
      <CodevMissionControlView
        agents={agents.map((agent) =>
          agent.origin === 'managed' ? { ...agent, canSteer: canCoSteer } : agent
        )}
        coordination={coordination}
        now={now}
        openKey={openKey}
        pendingAction={pendingAction}
        slots={slots}
        feed={feed}
        stopDescription={stopDescription}
        onRetryFeed={retryFeeds}
        onOpen={setOpenKey}
        onClose={() => setOpenKey(null)}
        onStepIn={handleStepIn}
        onSteer={handleSteer}
        onPause={handlePause}
        onStop={(key) => void handleStop(key)}
      />
    </div>
  )
}
