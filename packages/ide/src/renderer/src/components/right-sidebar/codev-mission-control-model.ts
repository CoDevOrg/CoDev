import { tabIdFromPaneKey } from './codev-local-agent-tabs'

/**
 * Mission Control's data model: the agent row, the coordination slice it is
 * decorated with, and every pure rule the view applies to them. Nothing here
 * touches React, so the identity, merge, ordering and notice logic is tested
 * as plain functions.
 */
export type MissionControlPhase =
  | 'planning'
  | 'working'
  | 'testing'
  | 'reviewing'
  | 'blocked'
  | 'waiting'
  | 'done'

/** One path this agent is holding, straight from `path_claims`. */
export type MissionControlHold = {
  claimId: string
  path: string
  status: 'active' | 'contested'
  /** How the claim was tied to this agent: its own session id, or only the
   *  checkout (worktree or branch) it runs in. */
  attribution: 'session' | 'checkout'
  /** True when the checkout match also fits another agent in the same
   *  checkout, so this row cannot be the sole holder on the evidence. */
  shared: boolean
}

export type MissionControlAgent = {
  /** Stable identity: `local:<paneKey>`, `local:tab:<tabId>` or `managed:<sessionId>`. */
  key: string
  /** `you` renders as "your chat tab"; `managed` exposes steer + pause. */
  origin: 'you' | 'managed'
  sessionId: string | null
  worktreeId: string | null
  /** The chat tab a local agent runs in. This — not the key — is what "Step
   *  in" activates and "Stop" closes, so two agents sharing a worktree are
   *  addressed individually. `null` for a managed session. */
  tabId: string | null
  /** The agent's git branch, when the renderer can resolve one. A CLI agent's
   *  claims are filed against its branch, so this is how a chat-tab agent —
   *  which has no CoDev session id here — is matched to what it holds. */
  branch: string | null
  ownerName: string
  ownerHue: number
  providerLabel: string
  model: string | null
  phase: MissionControlPhase
  /** The assignment, in the owner's words. */
  title: string
  /** The one line describing what it is doing right now. */
  activity: string
  /** Epoch ms; drives the live-ticking runtime for local agents. */
  startedAt: number | null
  /** `MM:SS` from the server, used when `startedAt` is unknown. */
  serverElapsed: string | null
  canSteer: boolean
  /** Paths this agent currently holds. Empty until the coordination snapshot
   *  arrives, and empty for an agent that has claimed nothing — never a guess. */
  holds: MissionControlHold[]
}

/** A lifecycle request in flight for one agent; the drawer disables the
 *  conflicting controls and labels the pending one while it runs. */
export type MissionControlPendingAction = 'stop' | 'pause' | 'steer'

/** Worktree slots in use, from the workboard. Distinct from the agent count:
 *  several agents share one checkout, and a chat in the workspace's own
 *  checkout holds no slot at all. */
export type MissionControlSlotUsage = { used: number; total: number }

/** Whether the live feeds behind the panel are current. `staleSince` is the
 *  first failed refresh after a good snapshot; the data on screen is from
 *  before it. */
export type MissionControlFeedHealth = { staleSince: number | null; message: string | null }

/** What Stop will do to the open agent, from its actual stop plan. */
export type MissionControlStopDescription = { allowed: boolean; button: string; detail: string }

export const MISSION_CONTROL_PHASE_LABEL: Record<MissionControlPhase, string> = {
  planning: 'Planning',
  working: 'Working',
  testing: 'Running tests',
  reviewing: 'In review',
  blocked: 'Blocked',
  waiting: 'Waiting',
  done: 'Ready to merge'
}

/** Ordering for the list: whatever needs a human first, settled work last. */
const PHASE_RANK: Record<MissionControlPhase, number> = {
  blocked: 0,
  working: 1,
  testing: 2,
  reviewing: 3,
  planning: 4,
  waiting: 5,
  done: 6
}

export function missionControlPhaseFromState(state: string): MissionControlPhase {
  if (state === 'blocked') {
    return 'blocked'
  }
  if (state === 'waiting') {
    return 'waiting'
  }
  if (state === 'done') {
    return 'done'
  }
  return 'working'
}

export function missionControlPhaseFromStatus(status: string): MissionControlPhase {
  const value = status.toLowerCase()
  if (/(block|conflict|claim)/.test(value)) {
    return 'blocked'
  }
  if (/(review|await review)/.test(value)) {
    return 'reviewing'
  }
  if (/test/.test(value)) {
    return 'testing'
  }
  if (/(plan|scoping)/.test(value)) {
    return 'planning'
  }
  if (/(done|merged|complete|ready|closed)/.test(value)) {
    return 'done'
  }
  if (/(wait|idle|queued|paused|standby)/.test(value)) {
    return 'waiting'
  }
  return 'working'
}

/** The slice of `coordination.list` the panel renders. */
export type MissionControlCoordination = {
  claims: {
    id: string
    sessionId: string
    worktreeId: string | null
    branch: string | null
    agentLabel: string
    path: string
    status: 'active' | 'contested'
  }[]
  /** Agents whose live claims cover the same files. Not keyed on one path: a
   *  claim can be a `dir/**` glob, and `apps/web/**` collides with
   *  `apps/web/lib/auth.ts`. */
  contests: {
    paths: string[]
    holders: { sessionId: string; agentLabel: string; paths: string[] }[]
  }[]
  /** The brain's *pre*-collision warning: two agents whose posted plans are
   *  converging, before either has claimed anything. */
  overlaps: {
    id: string
    sessionIds: string[]
    agentLabels: string[]
    kind: string
    score: number
    rationale: string
  }[]
}

export const EMPTY_MISSION_CONTROL_COORDINATION: MissionControlCoordination = {
  claims: [],
  contests: [],
  overlaps: []
}

/**
 * Hang each agent's real claims off its row.
 *
 * A session id is authoritative: an agent that has one gets exactly the claims
 * filed under it, never its neighbours' claims by virtue of sharing a
 * worktree. A chat-tab agent has no session id in this panel, so it is matched
 * on its worktree, then on its branch — the identity a CLI agent's `cli`
 * session is keyed on when the coordination MCP creates it. When two
 * session-less agents share that checkout the match is ambiguous, and the hold
 * says so instead of showing up on both as if each owned it.
 */
export function attachMissionControlHolds(
  agents: MissionControlAgent[],
  coordination: MissionControlCoordination
): MissionControlAgent[] {
  if (coordination.claims.length === 0) {
    return agents
  }
  const matchesCheckout = (
    agent: MissionControlAgent,
    claim: MissionControlCoordination['claims'][number]
  ): boolean =>
    Boolean(agent.worktreeId && claim.worktreeId === agent.worktreeId) ||
    Boolean(agent.branch && claim.branch === agent.branch)
  const sessionless = agents.filter((agent) => !agent.sessionId)
  return agents.map((agent) => {
    const holds = coordination.claims.flatMap((claim): MissionControlHold[] => {
      if (agent.sessionId) {
        return claim.sessionId === agent.sessionId
          ? [
              {
                claimId: claim.id,
                path: claim.path,
                status: claim.status,
                attribution: 'session',
                shared: false
              }
            ]
          : []
      }
      if (!matchesCheckout(agent, claim)) {
        return []
      }
      const shared = sessionless.some((other) => other !== agent && matchesCheckout(other, claim))
      return [
        {
          claimId: claim.id,
          path: claim.path,
          status: claim.status,
          attribution: 'checkout',
          shared
        }
      ]
    })
    return holds.length > 0 ? { ...agent, holds } : agent
  })
}

/**
 * The one line the panel is entitled to print about collisions. A contest is
 * two or more live sessions whose claims cover the same files — a fact in
 * `path_claims`, not an inference from an agent's status text.
 *
 * Every branch counts what it is about to describe rather than assuming two.
 * Saying "both" over three agents, or naming one path when the two claims are
 * a glob and a file inside it, is the same unsupported assertion this banner
 * was built to remove.
 */
export function missionControlContestNotice(
  coordination: MissionControlCoordination
): string | null {
  const [first, ...rest] = coordination.contests
  if (!first) {
    return null
  }
  if (rest.length > 0) {
    return `${coordination.contests.length} groups of agents hold overlapping claims, starting with ${first.paths.join(' / ')}.`
  }
  if (first.holders.length > 2) {
    return `${first.holders.length} agents hold overlapping claims on ${first.paths.join(' / ')}. CoDev has every one on record — none of these writes overwrites another silently.`
  }
  const [one, other] = first.holders
  if (!one || !other) {
    return null
  }
  if (first.paths.length === 1) {
    return `${one.agentLabel} and ${other.agentLabel} both hold ${first.paths[0]}. CoDev has the claim on record — the second write is contested, not silently overwritten.`
  }
  return `${one.agentLabel} holds ${one.paths.join(', ')} and ${other.agentLabel} holds ${other.paths.join(', ')}, which cover the same files. CoDev has both claims on record — neither write overwrites the other silently.`
}

/**
 * The brain's overlap warning, which fires *before* anyone claims a file: two
 * agents whose posted briefs are converging on the same work. It is a different
 * fact from a contest — nothing is held yet — so it gets its own quieter line
 * rather than being folded into the collision banner, and it is why
 * `coordination.list` carries overlaps at all.
 */
export function missionControlOverlapNotice(
  coordination: MissionControlCoordination
): string | null {
  const [first, ...rest] = coordination.overlaps
  if (!first) {
    return null
  }
  const who =
    first.agentLabels.length >= 2
      ? `${first.agentLabels[0]} and ${first.agentLabels[1]}`
      : (first.agentLabels[0] ?? 'Two agents')
  const more = rest.length > 0 ? ` (+${rest.length} more)` : ''
  return `Heads up — ${who} look like they are converging on the same work: ${first.rationale}${more}`
}

export function sortMissionControlAgents(agents: MissionControlAgent[]): MissionControlAgent[] {
  return [...agents].sort((a, b) => {
    const byPhase = PHASE_RANK[a.phase] - PHASE_RANK[b.phase]
    if (byPhase !== 0) {
      return byPhase
    }
    return (b.startedAt ?? 0) - (a.startedAt ?? 0)
  })
}

/**
 * Distinct local agents = distinct tabs. An agent is identified by the tab it
 * runs in, never by its worktree or provider: two chat tabs are two agents
 * even in one worktree and even both on Claude. `entries` must be newest-first
 * so the first row seen for each tab is the live one and a superseded row left
 * behind by a reload is dropped. Both pane-key forms resolve to their tab —
 * a retained legacy `<tabId>:<n>` row is the same agent as its stable-key
 * successor, and two legacy rows in one worktree are two agents. A row with
 * no derivable tab (a retained orchestration worker that reported before its
 * tab existed) falls back to worktree, then paneKey, so it is never merged
 * onto a real tab.
 */
export function distinctLocalAgentEntries<T extends { worktreeId?: string }>(
  entries: [string, T][]
): [string, T][] {
  const seen = new Set<string>()
  return entries.filter(([paneKey, entry]) => {
    const identity = tabIdFromPaneKey(paneKey) ?? entry.worktreeId ?? paneKey
    if (seen.has(identity)) {
      return false
    }
    seen.add(identity)
    return true
  })
}

/**
 * Managed sessions win over a local entry for the same worktree — but only
 * when the match is unambiguous. Viewing a managed agent's own worktree makes
 * its hooks report locally too, so one local row in a worktree a managed
 * session covers is that session's mirror. Several local rows in one worktree
 * were started deliberately (two chat-tab agents against the repo): keep every
 * one rather than letting an unrelated managed session erase them.
 */
export function mergeMissionControlAgents(
  managed: MissionControlAgent[],
  local: MissionControlAgent[]
): MissionControlAgent[] {
  const claimed = new Set(
    managed.map((agent) => agent.worktreeId).filter((id): id is string => Boolean(id))
  )
  const localPerWorktree = new Map<string, number>()
  for (const agent of local) {
    if (agent.worktreeId) {
      localPerWorktree.set(agent.worktreeId, (localPerWorktree.get(agent.worktreeId) ?? 0) + 1)
    }
  }
  const keptLocal = local.filter(
    (agent) =>
      !agent.worktreeId ||
      !claimed.has(agent.worktreeId) ||
      (localPerWorktree.get(agent.worktreeId) ?? 0) > 1
  )
  return sortMissionControlAgents([...managed, ...keptLocal])
}

export function missionControlInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return '·'
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase()
  }
  return (parts[0]![0]! + parts.at(-1)![0]!).toUpperCase()
}

export function missionControlFaceBackground(hue: number): string {
  return `linear-gradient(150deg, hsl(${hue} 60% 46%), hsl(${hue} 52% 32%))`
}

export function missionControlElapsed(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  }
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/**
 * A local `done` agent is not "ready to merge" — it is a chat session sitting
 * idle between turns. Only managed sessions reach a real merge-ready state.
 */
export function phaseLabel(agent: MissionControlAgent): string {
  if (agent.origin === 'you' && agent.phase === 'done') {
    return 'Idle'
  }
  return MISSION_CONTROL_PHASE_LABEL[agent.phase]
}

export function runtimeText(agent: MissionControlAgent, now: number): string {
  if (agent.phase === 'done') {
    return agent.origin === 'you' ? 'Idle' : 'Done'
  }
  if (agent.startedAt) {
    return missionControlElapsed(agent.startedAt, now)
  }
  return agent.serverElapsed ?? '—'
}
