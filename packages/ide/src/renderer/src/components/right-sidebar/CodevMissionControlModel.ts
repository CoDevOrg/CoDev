import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { MissionControlCoordination } from './CodevActivityFeed'
import { AGENT_STATUS_STATES } from '../../../../shared/agent-status-types'

export type MissionControlPhase =
  | 'planning'
  | 'working'
  | 'testing'
  | 'reviewing'
  | 'blocked'
  | 'waiting'
  | 'done'

export type MissionControlHold = {
  claimId: string
  path: string
  status: 'active' | 'contested'
}

export type MissionControlAgent = {
  key: string
  origin: 'you' | 'managed'
  sessionId: string | null
  worktreeId: string | null
  branch: string | null
  ownerName: string
  ownerHue: number
  providerLabel: string
  model: string | null
  phase: MissionControlPhase
  title: string
  activity: string
  startedAt: number | null
  serverElapsed: string | null
  canSteer: boolean
  holds: MissionControlHold[]
}

export const MISSION_CONTROL_PHASE_LABEL: Record<MissionControlPhase, string> = {
  planning: 'Planning',
  working: 'Working',
  testing: 'Running tests',
  reviewing: 'In review',
  blocked: 'Blocked',
  waiting: 'Waiting',
  done: 'Ready to merge'
}

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

export function attachMissionControlHolds(
  agents: MissionControlAgent[],
  coordination: MissionControlCoordination
): MissionControlAgent[] {
  if (coordination.claims.length === 0) {
    return agents
  }
  return agents.map((agent) => {
    const holds = coordination.claims
      .filter((claim) => {
        if (agent.sessionId && claim.sessionId === agent.sessionId) {
          return true
        }
        if (agent.worktreeId && claim.worktreeId === agent.worktreeId) {
          return true
        }
        return Boolean(agent.branch) && claim.branch === agent.branch
      })
      .map((claim) => ({ claimId: claim.id, path: claim.path, status: claim.status }))
    return holds.length > 0 ? { ...agent, holds } : agent
  })
}

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

export function distinctLocalAgentEntries<T extends { worktreeId?: string }>(
  entries: [string, T][]
): [string, T][] {
  const seen = new Set<string>()
  return entries.filter(([paneKey, entry]) => {
    const identity = parsePaneKey(paneKey)?.tabId ?? entry.worktreeId ?? paneKey
    if (seen.has(identity)) {
      return false
    }
    seen.add(identity)
    return true
  })
}

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

export function isMissionControlLiveState(value: unknown): boolean {
  return typeof value === 'string' && (AGENT_STATUS_STATES as readonly string[]).includes(value)
}

export function missionControlHueFor(key: string): number {
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 360
  }
  return hash
}
