import type { JSX } from 'react'
import {
  EMPTY_MISSION_CONTROL_COORDINATION,
  missionControlContestNotice,
  missionControlOverlapNotice,
  type MissionControlAgent,
  type MissionControlCoordination
} from './codev-mission-control-model'
import { AgentCard, Face } from './CodevMissionControlAgentCard'
import { AgentDrawer } from './CodevMissionControlDrawer'

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
  onStop
}: {
  agents: MissionControlAgent[]
  coordination?: MissionControlCoordination
  now: number
  openKey: string | null
  steerBusy: boolean
  onOpen: (key: string) => void
  onClose: () => void
  onStepIn: (key: string) => void
  /** May resolve false when the instruction was not accepted, so the drawer
   *  keeps the typed text. */
  onSteer: (key: string, text: string) => void | Promise<boolean>
  onPause: (key: string) => void
  onStop: (key: string) => void
}): JSX.Element {
  const open = agents.find((agent) => agent.key === openKey) ?? null
  const live = coordination ?? EMPTY_MISSION_CONTROL_COORDINATION
  const contestNotice = missionControlContestNotice(live)
  const overlapNotice = missionControlOverlapNotice(live)
  const working = agents.filter((agent) => agent.phase === 'working').length
  const blocked = agents.filter((agent) => agent.phase === 'blocked').length
  const owners: { name: string; hue: number }[] = []
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
          onStop={() => onStop(open.key)}
        />
      ) : null}
    </section>
  )
}
