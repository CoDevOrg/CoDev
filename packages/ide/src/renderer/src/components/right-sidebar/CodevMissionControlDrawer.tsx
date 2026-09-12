import { useState, type JSX } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { phaseLabel, runtimeText, type MissionControlAgent } from './codev-mission-control-model'
import { PhasePill } from './CodevMissionControlAgentCard'

const QUICK_STEERS = [
  'Add a test for that case',
  'Wrong approach — back out',
  'Explain your reasoning',
  'Looks good — keep going'
] as const

/**
 * The detail drawer for one agent: step in, steer, pause, stop.
 *
 * Built on the Dialog primitive rather than a bare `aside`: it looked modal
 * but focus stayed on the card underneath, Tab walked the obscured list, and
 * nothing came back on close. The primitive owns initial focus, the focus
 * trap, hiding the rest of the page from assistive tech, Escape, the scrim
 * click, and returning focus to the card that opened it.
 */
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
  /** Resolves false when the instruction was not accepted; the draft stays. */
  onSteer: (text: string) => void | Promise<boolean>
  onPause: () => void
  onStop: () => void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  // Stopping ends a running agent and frees its slot, so it asks first — in
  // place, because a modal over a drawer is a lot of chrome for one button.
  const [confirmingStop, setConfirmingStop] = useState(false)
  const steerable = agent.origin === 'managed' && agent.canSteer && Boolean(agent.sessionId)

  // The typed instruction is cleared only once the request is accepted. It
  // used to clear on click, so a failed steer took the text with it.
  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (!text) {
      return
    }
    const accepted = await onSteer(text)
    if (accepted !== false) {
      setDraft((current) => (current.trim() === text ? '' : current))
    }
  }

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogPrimitive.Overlay className="codev-mc-scrim" />
      <DialogPrimitive.Content
        className="codev-mc-drawer"
        aria-label={agent.title}
        aria-describedby={undefined}
      >
        <header className="codev-mc-drawer-head">
          <div>
            <p className="codev-mc-drawer-kicker">
              {agent.ownerName} · {agent.providerLabel}
              {agent.model ? ` · ${agent.model}` : ''}
            </p>
            <DialogPrimitive.Title asChild>
              <h4>{agent.title}</h4>
            </DialogPrimitive.Title>
          </div>
          <DialogPrimitive.Close asChild>
            <button type="button" className="codev-mc-drawer-close" aria-label="Close agent detail">
              ✕
            </button>
          </DialogPrimitive.Close>
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
          <button
            type="button"
            className="codev-mc-ghost"
            onClick={onStepIn}
            disabled={!agent.tabId && !agent.worktreeId}
            title={
              agent.tabId || agent.worktreeId
                ? undefined
                : 'This agent has no open chat or worktree to step into.'
            }
          >
            {agent.tabId
              ? 'Open this chat'
              : agent.worktreeId
                ? 'Open this worktree'
                : 'Nothing to open'}
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
                Stop and free the slot
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
          <p className="codev-mc-drawer-activity">
            Ends this agent and releases its slot. The branch it worked on is kept.
          </p>
        ) : null}

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
                    void submit()
                  }
                }}
                aria-label="Steer this agent"
              />
              <button
                type="button"
                className="codev-mc-steer-send"
                onClick={() => void submit()}
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
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  )
}
