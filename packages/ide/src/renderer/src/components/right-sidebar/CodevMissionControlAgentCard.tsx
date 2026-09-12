import type { JSX, KeyboardEvent } from 'react'
import {
  MISSION_CONTROL_PHASE_LABEL,
  missionControlFaceBackground,
  missionControlInitials,
  phaseLabel,
  runtimeText,
  type MissionControlAgent,
  type MissionControlHold,
  type MissionControlPhase
} from './codev-mission-control-model'

/** What a hold chip says on hover. A shared hold names its own uncertainty:
 *  the claim is filed against the checkout, and more than one agent runs there. */
function holdTitle(hold: MissionControlHold): string {
  if (hold.shared) {
    return `${hold.path} — claimed in this checkout, which several agents share; CoDev cannot tell which one holds it`
  }
  if (hold.status === 'contested') {
    return `${hold.path} — another agent is holding this too`
  }
  return `${hold.path} — claimed by this agent`
}

/** The card for one agent in the Mission Control list, plus the two marks
 *  (owner face, phase pill) the drawer reuses. */
export function Face({
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

export function PhasePill({
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

export function AgentCard({
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
                className={`codev-mc-hold is-${hold.status}${hold.shared ? ' is-shared' : ''}`}
                title={holdTitle(hold)}
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
