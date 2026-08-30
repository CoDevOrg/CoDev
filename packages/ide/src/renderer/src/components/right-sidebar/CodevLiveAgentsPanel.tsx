import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge
} from '../../web/codev-bridge'
import { AGENT_STATUS_STATES } from '../../../../shared/agent-status-types'
import {
  CodevMissionControlView,
  mergeMissionControlAgents,
  missionControlPhaseFromState,
  missionControlPhaseFromStatus,
  type MissionControlAgent
} from './CodevMissionControlView'

/**
 * Mission Control container.
 *
 * CoDev's premise is several people steering several agents against one
 * repository, and until now that was only legible by opening a panel and
 * reading a status string. This is the workspace's default right-sidebar tab,
 * so the state of the room is on screen while you work.
 *
 * Two real sources, merged:
 *
 *  - Orca's local `agentStatusByPaneKey` — the agent in *this* tab, updated as
 *    tokens stream. The workboard never sees a chat-tab PTY agent, so without
 *    this the panel would read "0 agents" with one visibly working.
 *  - `workboard.list` over the CoDev bridge — every teammate's managed agent
 *    session, polled on an interval, with real owner attribution and a
 *    session id that "Steer" and "Pause" act on.
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

function isLiveState(value: unknown): boolean {
  return (
    typeof value === 'string' && (AGENT_STATUS_STATES as readonly string[]).includes(value)
  )
}

/** Stable per-name hue so a person keeps one colour across the panel. */
function hueFor(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 360
  return hash
}

function providerLabel(raw: string): string {
  const value = raw.toLowerCase()
  if (value.includes('claude') || value.includes('anthropic')) return 'Claude'
  if (value.includes('codex') || value.includes('openai')) return 'Codex'
  if (value.includes('cursor')) return 'Cursor'
  if (!raw) return 'Agent'
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

/**
 * Orca's `terminalTitle` is whatever the PTY last set: sometimes the prompt
 * summary we want ("Repository overview"), but often the raw shell prompt
 * (`orca-ws-…@ip-10-…:/srv/codev/…`) or the bare CLI name. Take it only when
 * it reads like a task, not a shell line.
 */
function usableTaskTitle(raw: string | undefined, providerName: string): string | null {
  const value = raw?.replace(/^[\s✳✶✻*•]+/, '').trim()
  if (!value) return null
  if (/@|\/srv\/|~[/$]|\$\s*$|^orca-ws-/i.test(value)) return null
  if (value.toLowerCase() === providerName.toLowerCase()) return null
  if (/^(claude code|codex cli|cursor)$/i.test(value)) return null
  return value
}

export function CodevLiveAgentsPanel(): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
  const [now, setNow] = useState(() => Date.now())
  const [bridgeStatus, setBridgeStatus] = useState<string>(() =>
    typeof window === 'undefined' ? 'disconnected' : getCodevBridgeSnapshot().status
  )
  const [managed, setManaged] = useState<MissionControlAgent[]>([])
  const [viewerName, setViewerName] = useState('You')
  const [canCoSteer, setCanCoSteer] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [steerBusy, setSteerBusy] = useState(false)

  const statuses = useAppStore(useShallow((state) => state.agentStatusByPaneKey))

  useEffect(
    () =>
      subscribeCodevBridge(() => {
        setBridgeStatus(getCodevBridgeSnapshot().status)
      }),
    []
  )

  const local = useMemo<MissionControlAgent[]>(() => {
    const entries = Object.entries(statuses ?? {})
      // A status row with no agent identity is a plain terminal pane or a
      // half-torn-down entry, not an agent.
      .filter(([, entry]) => isLiveState(entry.state) && Boolean(entry.agentType))
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)

    // One agent per worktree in the chat-tab model. A reload can leave a
    // superseded status row behind (old tab + its replacement), so keep only
    // the most-recently-updated entry for each worktree; unattributed rows
    // (no worktreeId) are always kept.
    const seenWorktrees = new Set<string>()
    return entries
      .filter(([, entry]) => {
        if (!entry.worktreeId) return true
        if (seenWorktrees.has(entry.worktreeId)) return false
        seenWorktrees.add(entry.worktreeId)
        return true
      })
      .map(([paneKey, entry]) => {
        const label = providerLabel(String(entry.agentType ?? ''))
        const phase = missionControlPhaseFromState(entry.state)
        // The prompt is often blank for a native-chat turn, so fall back to the
        // agent tab's own title (Orca derives it from the first prompt) before
        // the generic label.
        const title =
          entry.prompt?.trim() || usableTaskTitle(entry.terminalTitle, label) || `${label} session`
        // What it is doing *right now*: a live question, then the current tool
        // call, then its last message, then the prompt, then a state default.
        const toolLine = entry.toolName
          ? `${entry.toolName}${entry.toolInput ? ` · ${entry.toolInput}` : ''}`
          : null
        const activity =
          entry.interactivePrompt?.trim() ||
          (phase === 'working' ? toolLine : null) ||
          entry.lastAssistantMessage?.trim() ||
          entry.prompt?.trim() ||
          (phase === 'done'
            ? 'Idle — send a message to continue.'
            : phase === 'blocked'
              ? 'Waiting on your input.'
              : 'Waiting for the next instruction.')
        return {
          key: `local:${paneKey}`,
          origin: 'you' as const,
          sessionId: null,
          worktreeId: entry.worktreeId ?? null,
          ownerName: viewerName,
          ownerHue: hueFor(viewerName || paneKey),
          providerLabel: label,
          model: entry.model ?? null,
          phase,
          title,
          activity,
          startedAt: entry.stateStartedAt,
          serverElapsed: null,
          canSteer: false
        }
      })
  }, [statuses, viewerName])

  const refreshManaged = useCallback(async () => {
    if (bridgeStatus !== 'connected') return
    try {
      const snapshot = await requestCodevBridge<WorkboardSnapshot>('workboard.list')
      if (snapshot?.viewer?.name) setViewerName(snapshot.viewer.name)
      setCanCoSteer(Boolean(snapshot?.viewer?.canCoSteer))
      const rows = (snapshot?.slots ?? [])
        .filter((slot) => slot.occupied && slot.sessionId)
        .map<MissionControlAgent>((slot) => ({
          key: `managed:${slot.sessionId}`,
          origin: 'managed',
          sessionId: slot.sessionId ?? null,
          worktreeId: slot.worktreeId ?? null,
          ownerName: slot.owner?.trim() || 'Teammate',
          ownerHue: hueFor(slot.owner?.trim() || String(slot.sessionId)),
          providerLabel: providerLabel(String(slot.provider ?? '')),
          model: null,
          phase: missionControlPhaseFromStatus(String(slot.status ?? '')),
          title: slot.assignment?.trim() || 'Agent session',
          activity: slot.currentTask?.trim() || slot.status?.trim() || 'Working.',
          startedAt: null,
          serverElapsed: slot.elapsed?.trim() || null,
          canSteer: Boolean(snapshot?.viewer?.canCoSteer)
        }))
      setManaged(rows)
    } catch {
      // Keep the last known managed set; local agents still render, and the
      // interval retries on its own.
    }
  }, [bridgeStatus])

  useEffect(() => {
    if (!embedded) return
    void refreshManaged()
    const timer = setInterval(() => void refreshManaged(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [embedded, refreshManaged])

  const agents = useMemo(
    () => mergeMissionControlAgents(managed, local),
    [managed, local]
  )

  const busy = agents.some((agent) => agent.phase !== 'done' && agent.phase !== 'waiting')

  useEffect(() => {
    if (!busy) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [busy])

  const byKey = useCallback(
    (key: string) => agents.find((agent) => agent.key === key) ?? null,
    [agents]
  )

  const handleStepIn = useCallback(
    (key: string) => {
      const agent = byKey(key)
      if (!agent) return
      if (agent.worktreeId) {
        activateAndRevealWorktree(agent.worktreeId, { revealInSidebar: true })
        setOpenKey(null)
        return
      }
      toast.message('This agent runs in your chat tab', {
        description: 'Open the chat tab to follow it live.'
      })
    },
    [byKey]
  )

  const handleSteer = useCallback(
    async (key: string, text: string) => {
      const agent = byKey(key)
      const prompt = text.trim()
      if (!agent?.sessionId || !prompt) return
      setSteerBusy(true)
      try {
        await requestCodevBridge('agents.enqueue', { sessionId: agent.sessionId, prompt })
        toast.success(`Steer queued for ${agent.ownerName}'s agent`)
        void refreshManaged()
      } catch (error: unknown) {
        toast.error('Could not steer this agent', {
          description: error instanceof Error ? error.message : String(error)
        })
      } finally {
        setSteerBusy(false)
      }
    },
    [byKey, refreshManaged]
  )

  const handlePause = useCallback(
    async (key: string) => {
      const agent = byKey(key)
      if (!agent?.sessionId) return
      try {
        await requestCodevBridge('agents.interrupt', { sessionId: agent.sessionId })
        toast.success('Asked the agent to pause after this step')
        void refreshManaged()
      } catch (error: unknown) {
        toast.error('Could not pause this agent', {
          description: error instanceof Error ? error.message : String(error)
        })
      }
    },
    [byKey, refreshManaged]
  )

  if (!embedded) return null

  return (
    <CodevMissionControlView
      agents={agents.map((agent) =>
        agent.origin === 'managed' ? { ...agent, canSteer: canCoSteer } : agent
      )}
      now={now}
      openKey={openKey}
      steerBusy={steerBusy}
      onOpen={setOpenKey}
      onClose={() => setOpenKey(null)}
      onStepIn={handleStepIn}
      onSteer={handleSteer}
      onPause={handlePause}
    />
  )
}
