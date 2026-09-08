import type { JSX, KeyboardEvent } from 'react'
import {
  ActivitySection,
  ActivityTimeline,
  EMPTY_MISSION_CONTROL_COORDINATION,
  missionControlActivityItems,
  type MissionControlCoordination
} from './CodevActivityFeed'
import {
  MISSION_CONTROL_PHASE_LABEL,
  missionControlContestNotice,
  missionControlElapsed,
  missionControlFaceBackground,
  missionControlInitials,
  missionControlOverlapNotice,
  type MissionControlAgent,
  type MissionControlPhase
} from './CodevMissionControlModel'
import { AgentDrawer } from './CodevMissionControlAgentDrawer'
export {
  EMPTY_MISSION_CONTROL_COORDINATION,
  missionControlActivityItems,
  type MissionControlCoordination
} from './CodevActivityFeed'
export * from './CodevMissionControlModel'

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

/**
 * A local `done` agent is not "ready to merge" — it is a chat session sitting
 * idle between turns. Only managed sessions reach a real merge-ready state.
 */
function phaseLabel(agent: MissionControlAgent): string {
  if (agent.origin === 'you' && agent.phase === 'done') {
    return 'Idle'
  }
  return MISSION_CONTROL_PHASE_LABEL[agent.phase]
}

function runtimeText(agent: MissionControlAgent, now: number): string {
  if (agent.phase === 'done') {
    return agent.origin === 'you' ? 'Idle' : 'Done'
  }
  if (agent.startedAt) {
    return missionControlElapsed(agent.startedAt, now)
  }
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
  onPause,
  onStop,
  onOpenContext
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
  onStop: (key: string) => void
  onOpenContext?: (sessionIds: string[], worktreeIds: string[]) => void
}): JSX.Element {
  const open = agents.find((agent) => agent.key === openKey) ?? null
  const live = coordination ?? EMPTY_MISSION_CONTROL_COORDINATION
  const contestNotice = missionControlContestNotice(live)
  const overlapNotice = missionControlOverlapNotice(live)
  const working = agents.filter((agent) => agent.phase === 'working').length
  const blocked = agents.filter((agent) => agent.phase === 'blocked').length
  const activity = missionControlActivityItems(live)
  const needsAttention = live.contests.length + live.overlaps.length + blocked
  const owners: { name: string; hue: number }[] = []
  for (const agent of agents) {
    if (!owners.some((owner) => owner.name === agent.ownerName)) {
      owners.push({ name: agent.ownerName, hue: agent.ownerHue })
    }
  }

  return (
    <section className="codev-agents-panel codev-mc" aria-label="Workspace activity">
      <header className="codev-agents-head">
        <div>
          <p className="codev-agents-kicker">
            <i className="codev-agents-dot" aria-hidden />
            {working > 0 ? `${working} working now` : 'Live in this workspace'}
          </p>
          <h3>Activity</h3>
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

      {needsAttention > 0 ? (
        <ActivitySection title="Needs attention" count={needsAttention}>
          <div className="codev-mc-attention" role="status">
            {contestNotice ? <p className="codev-mc-alert">{contestNotice}</p> : null}
            {overlapNotice ? <p className="codev-mc-alert is-soft">{overlapNotice}</p> : null}
            {blocked > 0 ? (
              <p className="codev-mc-alert is-soft">
                {blocked === 1
                  ? 'One agent is waiting on you.'
                  : `${blocked} agents are waiting on you.`}
              </p>
            ) : null}
          </div>
        </ActivitySection>
      ) : null}

      <ActivitySection title="Working now" count={agents.length}>
        {agents.length === 0 ? (
          <p className="codev-agents-empty">
            No agents are running yet. Open a chat and give an agent a task; its progress and file
            claims will appear here.
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
      </ActivitySection>

      {activity.length > 0 ? (
        <ActivitySection title="Recent coordination">
          <ActivityTimeline
            items={activity}
            now={now}
            onOpenContext={onOpenContext ?? (() => undefined)}
          />
        </ActivitySection>
      ) : null}

      {open ? (
        <AgentDrawer
          agent={open}
          now={now}
          busy={steerBusy}
          onClose={onClose}
          onStepIn={() => onStepIn(open.key)}
          onSteer={(text) => onSteer(open.key, text)}
          onPause={() => onPause(open.key)}
          onStop={() => onStop(open.key)}
        />
      ) : null}
    </section>
  )
}
