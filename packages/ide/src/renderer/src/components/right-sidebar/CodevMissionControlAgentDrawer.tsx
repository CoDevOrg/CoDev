import { useEffect, useState, type JSX } from 'react'
import {
  MISSION_CONTROL_PHASE_LABEL,
  missionControlElapsed,
  type MissionControlAgent,
  type MissionControlPhase
} from './CodevMissionControlModel'

const QUICK_STEERS = [
  'Add a test for that case',
  'Wrong approach — back out',
  'Explain your reasoning',
  'Looks good — keep going'
] as const

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

function PhasePill({ phase, label }: { phase: MissionControlPhase; label?: string }): JSX.Element {
  return (
    <span className={`codev-mc-phase is-${phase}`}>
      <i aria-hidden />
      {label ?? MISSION_CONTROL_PHASE_LABEL[phase]}
    </span>
  )
}

export function AgentDrawer({
  agent,
  now,
  busy,
  onClose,
  onStepIn,
  onSteer,
  onPause,
  onStop
}: {
  agent: MissionControlAgent
  now: number
  busy: boolean
  onClose: () => void
  onStepIn: () => void
  onSteer: (text: string) => void
  onPause: () => void
  onStop: () => void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const [confirmingStop, setConfirmingStop] = useState(false)
  const steerable = agent.origin === 'managed' && agent.canSteer && Boolean(agent.sessionId)

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (): void => {
    const text = draft.trim()
    if (!text) {
      return
    }
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
            {agent.origin === 'you' ? 'In your chat' : 'Shared agent'}
          </span>
        </div>

        <p className="codev-mc-drawer-activity">
          <strong>Current focus</strong>
          <span>
            <i className="codev-mc-caret" aria-hidden />
            {agent.activity}
          </span>
        </p>

        <div className="codev-mc-drawer-actions">
          <button type="button" className="codev-mc-ghost" onClick={onStepIn}>
            {agent.worktreeId ? 'Open workspace' : 'Open chat'}
          </button>
          {steerable ? (
            <button type="button" className="codev-mc-ghost" onClick={onPause} disabled={busy}>
              Pause
            </button>
          ) : null}
          {confirmingStop ? (
            <>
              <button
                type="button"
                className="codev-mc-ghost is-danger"
                disabled={busy}
                onClick={() => {
                  setConfirmingStop(false)
                  onStop()
                }}
              >
                Stop agent
              </button>
              <button
                type="button"
                className="codev-mc-ghost"
                onClick={() => setConfirmingStop(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="codev-mc-ghost is-danger"
              disabled={busy}
              onClick={() => setConfirmingStop(true)}
            >
              Stop agent
            </button>
          )}
        </div>
        {confirmingStop ? (
          <p className="codev-mc-drawer-activity">This stops the agent. Its branch is kept.</p>
        ) : null}

        {steerable ? (
          <footer className="codev-mc-steer">
            <p className="codev-mc-steer-title">Give this agent direction</p>
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
                placeholder={`Tell ${agent.ownerName.split(' ')[0] ?? 'this agent'} what to do next…`}
                value={draft}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submit()
                  }
                }}
                aria-label="Give this agent direction"
              />
              <button
                type="button"
                className="codev-mc-steer-send"
                onClick={submit}
                disabled={busy || !draft.trim()}
              >
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
            <p className="codev-mc-steer-note">
              Your instruction is added to the shared conversation.
            </p>
          </footer>
        ) : (
          <p className="codev-mc-steer-note">
            {agent.origin === 'you'
              ? 'This agent is in your chat. Type there to give it direction.'
              : 'You need permission to give this agent direction.'}
          </p>
        )}
      </aside>
    </>
  )
}
