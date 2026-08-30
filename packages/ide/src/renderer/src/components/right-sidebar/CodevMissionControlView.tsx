import { useEffect, useState, type JSX, type KeyboardEvent } from 'react'

/**
 * Mission Control — the workspace's live agent view.
 *
 * Pure and prop-driven so it renders identically from the container's merged
 * feed and from a test's fixture. The container (`CodevLiveAgentsPanel`) owns
 * the two real sources this stitches together:
 *
 *  - your own agent, from Orca's local `agentStatusByPaneKey`, updated the
 *    instant a token streams; and
 *  - every teammate's managed agent session, polled over the CoDev bridge
 *    (`workboard.list`), so the panel shows the whole room, not just this tab.
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

export type MissionControlAgent = {
  /** Stable identity: `local:<paneKey>` or `managed:<sessionId>`. */
  key: string
  /** `you` renders as "your chat tab"; `managed` exposes steer + pause. */
  origin: 'you' | 'managed'
  sessionId: string | null
  worktreeId: string | null
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

export function sortMissionControlAgents(agents: MissionControlAgent[]): MissionControlAgent[] {
  return [...agents].sort((a, b) => {
    const byPhase = PHASE_RANK[a.phase] - PHASE_RANK[b.phase]
    if (byPhase !== 0) return byPhase
    return (b.startedAt ?? 0) - (a.startedAt ?? 0)
  })
}

/**
 * Managed sessions win over a local entry for the same worktree: a teammate's
 * co-steered session and this tab's mirror of it are one agent, and the
 * managed record carries the real owner and session id.
 */
export function mergeMissionControlAgents(
  managed: MissionControlAgent[],
  local: MissionControlAgent[]
): MissionControlAgent[] {
  const claimed = new Set(
    managed.map((agent) => agent.worktreeId).filter((id): id is string => Boolean(id))
  )
  const keptLocal = local.filter((agent) => !agent.worktreeId || !claimed.has(agent.worktreeId))
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

function PhasePill({
  phase,
  label
}: {
  phase: MissionControlPhase
  label?: string
}): JSX.Element {
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
          <Face name={agent.ownerName} hue={agent.ownerHue} title={`Started by ${agent.ownerName}`} />
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

      {blocked > 0 ? (
        <p className="codev-mc-alert" role="status">
          {blocked === 1
            ? 'One agent is blocked on a file claim — CoDev is holding the write so two agents cannot collide.'
            : `${blocked} agents are blocked on file claims.`}
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
