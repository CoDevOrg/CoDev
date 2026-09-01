import { useEffect, useState, type JSX, type KeyboardEvent } from 'react'
import { parsePaneKey } from '../../../../shared/stable-pane-id'

/**
 * Mission Control — the workspace's live agent view.
 *
 * Pure and prop-driven so it renders identically from the container's merged
 * feed and from a test's fixture. The container (`CodevLiveAgentsPanel`) owns
 * the two real sources this stitches together:
 *
 *  - your own agent, from Orca's local `agentStatusByPaneKey`, updated the
 *    instant a token streams;
 *  - every teammate's managed agent session, polled over the CoDev bridge
 *    (`workboard.list`), so the panel shows the whole room, not just this tab;
 *    and
 *  - the workspace's live path claims and brain overlaps (`coordination.list`),
 *    which is what the collision banner and the per-agent holds are actually
 *    made of.
 *
 * Nothing here is simulated. "Step in" reveals the agent's worktree; "Steer"
 * and "Pause" call the same co-steer endpoints the workboard uses.
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
}

export type MissionControlAgent = {
  /** Stable identity: `local:<paneKey>` or `managed:<sessionId>`. */
  key: string
  /** `you` renders as "your chat tab"; `managed` exposes steer + pause. */
  origin: 'you' | 'managed'
  sessionId: string | null
  worktreeId: string | null
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

const QUICK_STEERS = [
  'Add a test for that case',
  'Wrong approach — back out',
  'Explain your reasoning',
  'Looks good — keep going'
] as const

export function missionControlPhaseFromState(state: string): MissionControlPhase {
  if (state === 'blocked') return 'blocked'
  if (state === 'waiting') return 'waiting'
  if (state === 'done') return 'done'
  return 'working'
}

export function missionControlPhaseFromStatus(status: string): MissionControlPhase {
  const value = status.toLowerCase()
  if (/(block|conflict|claim)/.test(value)) return 'blocked'
  if (/(review|await review)/.test(value)) return 'reviewing'
  if (/test/.test(value)) return 'testing'
  if (/(plan|scoping)/.test(value)) return 'planning'
  if (/(done|merged|complete|ready|closed)/.test(value)) return 'done'
  if (/(wait|idle|queued|paused|standby)/.test(value)) return 'waiting'
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
 * A managed session is matched on its CoDev session id. A chat-tab agent has no
 * session id in this panel, so it is matched on its worktree, then on its
 * branch — which is the identity a CLI agent's `cli` session is keyed on when
 * the coordination MCP creates it. Nothing is matched by name or guessed: an
 * agent whose claims cannot be identified shows no holds rather than someone
 * else's.
 */
export function attachMissionControlHolds(
  agents: MissionControlAgent[],
  coordination: MissionControlCoordination
): MissionControlAgent[] {
  if (coordination.claims.length === 0) return agents
  return agents.map((agent) => {
    const holds = coordination.claims
      .filter((claim) => {
        if (agent.sessionId && claim.sessionId === agent.sessionId) return true
        if (agent.worktreeId && claim.worktreeId === agent.worktreeId) return true
        return Boolean(agent.branch) && claim.branch === agent.branch
      })
      .map((claim) => ({
        claimId: claim.id,
        path: claim.path,
        status: claim.status
      }))
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
  if (!first) return null
  if (rest.length > 0) {
    return `${coordination.contests.length} groups of agents hold overlapping claims, starting with ${first.paths.join(' / ')}.`
  }
  if (first.holders.length > 2) {
    return `${first.holders.length} agents hold overlapping claims on ${first.paths.join(' / ')}. CoDev has every one on record — none of these writes overwrites another silently.`
  }
  const [one, other] = first.holders
  if (!one || !other) return null
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
  if (!first) return null
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
    if (byPhase !== 0) return byPhase
    return (b.startedAt ?? 0) - (a.startedAt ?? 0)
  })
}

/**
 * Distinct local agents = distinct tabs. An agent is identified by the tab it
 * runs in, never by its worktree or provider: two chat tabs are two agents
 * even in one worktree and even both on Claude. `entries` must be newest-first
 * so the first row seen for each tab is the live one and a superseded row left
 * behind by a reload is dropped. A row with no derivable tab (a retained
 * orchestration worker that reported before its tab existed) falls back to
 * worktree, then paneKey, so it is never merged onto a real tab.
 */
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
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function missionControlFaceBackground(hue: number): string {
  return `linear-gradient(150deg, hsl(${hue} 60% 46%), hsl(${hue} 52% 32%))`
}

export function missionControlElapsed(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/**
 * A local `done` agent is not "ready to merge" — it is a chat session sitting
 * idle between turns. Only managed sessions reach a real merge-ready state.
 */
function phaseLabel(agent: MissionControlAgent): string {
  if (agent.origin === 'you' && agent.phase === 'done') return 'Idle'
  return MISSION_CONTROL_PHASE_LABEL[agent.phase]
}

function runtimeText(agent: MissionControlAgent, now: number): string {
  if (agent.phase === 'done') return agent.origin === 'you' ? 'Idle' : 'Done'
  if (agent.startedAt) return missionControlElapsed(agent.startedAt, now)
  return agent.serverElapsed ?? '—'
}

function Face({
  name,
  hue,
  size = 22,
  title
}: {
  name: string
  hue: number
  size?: number
  title?: string
}): JSX.Element {
  return (
    <span
      className="codev-mc-face"
      title={title ?? name}
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: missionControlFaceBackground(hue)
      }}
    >
      {missionControlInitials(name)}
    </span>
  )
}

function PhasePill({ phase, label }: { phase: MissionControlPhase; label?: string }): JSX.Element {
  return (
    <span className={`codev-mc-phase is-${phase}`}>
      <i aria-hidden />
      {label ?? MISSION_CONTROL_PHASE_LABEL[phase]}
    </span>
  )
}

function AgentCard({
  agent,
  now,
  onOpen,
  onStepIn
}: {
  agent: MissionControlAgent
  now: number
  onOpen: () => void
  onStepIn: () => void
}): JSX.Element {
  const activate = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen()
    }
  }

  return (
    <li className={`codev-mc-card is-${agent.phase}`}>
      <div
        className="codev-mc-card-open"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={activate}
      >
        <div className="codev-mc-card-head">
          <Face
            name={agent.ownerName}
            hue={agent.ownerHue}
            title={`Started by ${agent.ownerName}`}
          />
          <div className="codev-mc-card-who">
            <span className="codev-mc-owner">{agent.ownerName}</span>
            <span className="codev-mc-sub">
              {agent.providerLabel}
              {agent.model ? ` · ${agent.model}` : ''}
            </span>
          </div>
          <PhasePill phase={agent.phase} label={phaseLabel(agent)} />
        </div>

        <p className="codev-mc-title">{agent.title}</p>

        <p className={`codev-mc-activity${agent.phase === 'blocked' ? ' is-blocked' : ''}`}>
          <i className="codev-mc-caret" aria-hidden />
          <span>{agent.activity}</span>
        </p>

        {agent.holds.length > 0 ? (
          <ul className="codev-mc-holds" aria-label="Paths this agent has claimed">
            {agent.holds.map((hold) => (
              <li
                key={hold.claimId}
                className={`codev-mc-hold is-${hold.status}`}
                title={
                  hold.status === 'contested'
                    ? `${hold.path} — another agent is holding this too`
                    : `${hold.path} — claimed by this agent`
                }
              >
                <i aria-hidden />
                <span>{hold.path}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="codev-mc-cardfoot">
          <span className="codev-mc-runtime">{runtimeText(agent, now)}</span>
          <span className="codev-mc-tag">
            {agent.origin === 'you' ? 'your chat tab' : 'managed session'}
          </span>
        </div>
      </div>

      <div className="codev-mc-card-actions">
        <button type="button" onClick={onStepIn}>
          Step in
        </button>
        <button type="button" onClick={onOpen} disabled={agent.origin !== 'managed'}>
          Steer
        </button>
      </div>
    </li>
  )
}

function AgentDrawer({
  agent,
  now,
  busy,
  onClose,
  onStepIn,
  onSteer,
  onPause
}: {
  agent: MissionControlAgent
  now: number
  busy: boolean
  onClose: () => void
  onStepIn: () => void
  onSteer: (text: string) => void
  onPause: () => void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const steerable = agent.origin === 'managed' && agent.canSteer && Boolean(agent.sessionId)

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (): void => {
    const text = draft.trim()
    if (!text) return
    onSteer(text)
    setDraft('')
  }

  return (
    <>
      <div className="codev-mc-scrim" onClick={onClose} aria-hidden />
      <aside className="codev-mc-drawer" role="dialog" aria-modal="true" aria-label={agent.title}>
        <header className="codev-mc-drawer-head">
          <div>
            <p className="codev-mc-drawer-kicker">
              {agent.ownerName} · {agent.providerLabel}
              {agent.model ? ` · ${agent.model}` : ''}
            </p>
            <h4>{agent.title}</h4>
          </div>
          <button
            type="button"
            className="codev-mc-drawer-close"
            onClick={onClose}
            aria-label="Close agent detail"
          >
            ✕
          </button>
        </header>

        <div className="codev-mc-drawer-strip">
          <PhasePill phase={agent.phase} label={phaseLabel(agent)} />
          <span className="codev-mc-chip">{runtimeText(agent, now)}</span>
          <span className="codev-mc-chip">
            {agent.origin === 'you' ? 'Your chat tab' : 'Managed session'}
          </span>
        </div>

        <p className="codev-mc-drawer-activity">
          <i className="codev-mc-caret" aria-hidden />
          <span>{agent.activity}</span>
        </p>

        <div className="codev-mc-drawer-actions">
          <button type="button" className="codev-mc-ghost" onClick={onStepIn}>
            {agent.worktreeId ? 'Open this worktree' : 'Open the chat tab'}
          </button>
          {steerable ? (
            <button type="button" className="codev-mc-ghost" onClick={onPause} disabled={busy}>
              Pause
            </button>
          ) : null}
        </div>

        {steerable ? (
          <footer className="codev-mc-steer">
            <div className="codev-mc-quick">
              {QUICK_STEERS.map((text) => (
                <button
                  key={text}
                  type="button"
                  className="codev-mc-quick-chip"
                  disabled={busy}
                  onClick={() => onSteer(text)}
                >
                  {text}
                </button>
              ))}
            </div>
            <div className="codev-mc-steer-row">
              <input
                className="codev-mc-steer-input"
                placeholder={`Steer ${agent.ownerName.split(' ')[0] ?? 'this'}'s agent…`}
                value={draft}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submit()
                  }
                }}
                aria-label="Steer this agent"
              />
              <button
                type="button"
                className="codev-mc-steer-send"
                onClick={submit}
                disabled={busy || !draft.trim()}
              >
                {busy ? 'Sending…' : 'Steer'}
              </button>
            </div>
            <p className="codev-mc-steer-note">
              Queued as a co-steer turn — every instruction is attributed in the shared transcript.
            </p>
          </footer>
        ) : (
          <p className="codev-mc-steer-note">
            {agent.origin === 'you'
              ? 'This agent runs in your chat tab — type there to steer it directly.'
              : 'Co-steer permission is required to send this agent instructions.'}
          </p>
        )}
      </aside>
    </>
  )
}

export function CodevMissionControlView({
  agents,
  coordination,
  now,
  openKey,
  steerBusy,
  onOpen,
  onClose,
  onStepIn,
  onSteer,
  onPause
}: {
  agents: MissionControlAgent[]
  coordination?: MissionControlCoordination
  now: number
  openKey: string | null
  steerBusy: boolean
  onOpen: (key: string) => void
  onClose: () => void
  onStepIn: (key: string) => void
  onSteer: (key: string, text: string) => void
  onPause: (key: string) => void
}): JSX.Element {
  const open = agents.find((agent) => agent.key === openKey) ?? null
  const live = coordination ?? EMPTY_MISSION_CONTROL_COORDINATION
  const contestNotice = missionControlContestNotice(live)
  const overlapNotice = missionControlOverlapNotice(live)
  const working = agents.filter((agent) => agent.phase === 'working').length
  const blocked = agents.filter((agent) => agent.phase === 'blocked').length
  const owners: Array<{ name: string; hue: number }> = []
  for (const agent of agents) {
    if (!owners.some((owner) => owner.name === agent.ownerName)) {
      owners.push({ name: agent.ownerName, hue: agent.ownerHue })
    }
  }

  return (
    <section className="codev-agents-panel codev-mc" aria-label="Live agents in this workspace">
      <header className="codev-agents-head">
        <div>
          <p className="codev-agents-kicker">
            <i className="codev-agents-dot" aria-hidden />
            {working > 0 ? `${working} working now` : 'Live in this workspace'}
          </p>
          <h3>Mission Control</h3>
        </div>
        <span className="codev-agents-count">
          <strong>{agents.length}</strong>
          <span>/ {Math.max(agents.length, 3)}</span>
        </span>
      </header>

      {owners.length > 0 ? (
        <div className="codev-mc-people">
          <div className="codev-mc-people-faces">
            {owners.map((owner) => (
              <Face
                key={owner.name}
                name={owner.name}
                hue={owner.hue}
                size={24}
                title={`${owner.name} in this workspace`}
              />
            ))}
          </div>
          <span className="codev-mc-people-label">
            {owners.length === 1 ? '1 person steering' : `${owners.length} people steering`}
          </span>
        </div>
      ) : null}

      {contestNotice ? (
        <p className="codev-mc-alert" role="status">
          {contestNotice}
        </p>
      ) : null}

      {overlapNotice ? (
        <p className="codev-mc-alert is-soft" role="status">
          {overlapNotice}
        </p>
      ) : null}

      {!contestNotice && !overlapNotice && blocked > 0 ? (
        <p className="codev-mc-alert is-soft" role="status">
          {blocked === 1 ? 'One agent is waiting on you.' : `${blocked} agents are waiting on you.`}
        </p>
      ) : null}

      {agents.length === 0 ? (
        <p className="codev-agents-empty">
          No agents are running yet. Start one from the chat tab, or open the agent workboard to
          launch a managed session — it appears here the moment it moves.
        </p>
      ) : (
        <ul className="codev-mc-list">
          {agents.map((agent) => (
            <AgentCard
              key={agent.key}
              agent={agent}
              now={now}
              onOpen={() => onOpen(agent.key)}
              onStepIn={() => onStepIn(agent.key)}
            />
          ))}
        </ul>
      )}

      {open ? (
        <AgentDrawer
          agent={open}
          now={now}
          busy={steerBusy}
          onClose={onClose}
          onStepIn={() => onStepIn(open.key)}
          onSteer={(text) => onSteer(open.key, text)}
          onPause={() => onPause(open.key)}
        />
      ) : null}
    </section>
  )
}
