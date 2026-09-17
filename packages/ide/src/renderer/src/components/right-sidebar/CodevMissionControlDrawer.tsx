import { useState, type JSX } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { X } from 'lucide-react'
import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'
import {
  phaseLabel,
  runtimeText,
  type MissionControlAgent,
  type MissionControlPendingAction,
  type MissionControlStopDescription
} from './codev-mission-control-model'
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
const FALLBACK_STOP: MissionControlStopDescription = {
  allowed: true,
  button: 'Stop agent',
  detail: 'Ends this agent. The branch it worked on is kept.'
}

export function AgentDrawer({
  agent,
  now,
  pendingAction,
  stopDescription,
  onClose,
  onStepIn,
  onSteer,
  onPause,
  onStop
}: {
  agent: MissionControlAgent
  now: number
  /** Which lifecycle request is in flight for this agent, if any. Every
   *  other lifecycle control is disabled meanwhile, and the pending one says
   *  so — a stop used to snap back to "Stop agent" while still running. */
  pendingAction: MissionControlPendingAction | null
  /** Derived from the real stop plan; the confirmation must not promise a
   *  freed slot for a stop that leaves the checkout standing. */
  stopDescription: MissionControlStopDescription | null
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
  const steerable =
    agent.origin === 'managed' && agent.permissions.canSteer && Boolean(agent.sessionId)
  const busy = pendingAction !== null
  const stop = agent.permissions.canStop
    ? (stopDescription ?? FALLBACK_STOP)
    : {
        allowed: false,
        button: 'Stop agent',
        detail: agent.permissions.stopReason ?? 'You do not have permission to stop this agent.'
      }
  const openLabel = agent.tabId
    ? 'Open this chat'
    : agent.worktreeId
      ? 'Open this branch'
      : agent.conversation
        ? 'Open conversation'
        : 'Preparing branch…'
  const canOpen = Boolean(agent.tabId || agent.worktreeId || agent.conversation)
  const accessRows = [
    ['View', agent.permissions.canView ? 'Available' : 'Unavailable', null],
    [
      'Steer',
      agent.permissions.canSteer ? 'Available' : 'Unavailable',
      agent.permissions.steerReason
    ],
    [
      'Pause',
      agent.permissions.canPause ? 'Available' : 'Unavailable',
      agent.permissions.pauseReason
    ],
    [
      'Edit',
      agent.permissions.canEdit ? 'Branch workspace' : 'Preparing',
      agent.permissions.editReason
    ],
    [
      'Publish',
      agent.permissions.canPublish ? 'Use Source Control' : 'Unavailable',
      agent.permissions.publishReason
    ],
    ['Stop', agent.permissions.canStop ? 'Available' : 'Unavailable', agent.permissions.stopReason]
  ] as const

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
              Owner · {agent.ownerName} · Agent · {agent.agentName} · {agent.providerLabel}
              {agent.model ? ` · ${agent.model}` : ''}
            </p>
            <DialogPrimitive.Title asChild>
              <h4>{agent.title}</h4>
            </DialogPrimitive.Title>
          </div>
          <DialogPrimitive.Close asChild>
            <button type="button" className="codev-mc-drawer-close" aria-label="Close agent detail">
              <X size={16} aria-hidden="true" />
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
        {agent.permissions.canSteer === false &&
        agent.permissions.steerReason?.includes('connection') ? (
          <p className="codev-mc-alert is-soft" role="alert">
            {agent.permissions.steerReason} Open provider settings, reconnect, then retry this
            action.
          </p>
        ) : null}

        <div className="codev-mc-drawer-actions">
          <button
            type="button"
            className="codev-mc-ghost"
            onClick={onStepIn}
            disabled={!canOpen}
            title={canOpen ? undefined : 'The branch workspace is still being prepared.'}
          >
            {openLabel}
          </button>
          {steerable && agent.permissions.canPause ? (
            <button
              type="button"
              className="codev-mc-ghost"
              onClick={onPause}
              disabled={busy}
              aria-busy={pendingAction === 'pause'}
            >
              {pendingAction === 'pause' ? 'Pausing…' : 'Pause'}
            </button>
          ) : null}
          {pendingAction === 'stop' ? (
            <button type="button" className="codev-mc-ghost is-danger" disabled aria-busy>
              Stopping…
            </button>
          ) : !stop.allowed ? (
            <button type="button" className="codev-mc-ghost is-danger" disabled title={stop.detail}>
              {stop.button}
            </button>
          ) : confirmingStop ? (
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
                {stop.button}
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
        {confirmingStop && stop.allowed && pendingAction !== 'stop' ? (
          <p className="codev-mc-drawer-activity">{stop.detail}</p>
        ) : null}
        {!stop.allowed ? <p className="codev-mc-drawer-activity">{stop.detail}</p> : null}

        <section className="codev-mc-access" aria-label="Agent permissions">
          <h5>Access</h5>
          <dl>
            {accessRows.map(([label, value, reason]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd title={reason ?? undefined}>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="codev-mc-steer-note">
            Access is shown separately from ownership. Branch editing and publishing are still
            checked by the branch and Source Control surfaces.
          </p>
        </section>

        {agent.conversation ? (
          <section className="codev-mc-conversation" aria-label="Agent conversation">
            <div className="codev-mc-conversation-head">
              <h5>Conversation</h5>
              <span>{agent.conversation.transcript.length} completed turns</span>
            </div>
            {agent.conversation.attributedQueue?.length ? (
              <p className="codev-mc-drawer-activity">
                {agent.conversation.attributedQueue.length === 1
                  ? 'One instruction is queued.'
                  : `${agent.conversation.attributedQueue.length} instructions are queued.`}
              </p>
            ) : null}
            {agent.conversation.transcript.length > 0 ? (
              <div className="codev-mc-conversation-list">
                {agent.conversation.transcript.slice(-8).map((turn) => (
                  <article key={turn.turnId}>
                    <div>
                      <strong>{turn.authorName}</strong>
                      <span>{turn.status}</span>
                    </div>
                    <p>{turn.prompt}</p>
                    {turn.output ? <p>{turn.output}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="codev-mc-steer-note">
                No completed turns yet. The shared conversation will appear here as the agent works.
              </p>
            )}
          </section>
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
                  // Enter that only commits an IME candidate must not steer.
                  if (isImeCompositionKeyDown(event)) {
                    return
                  }
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
                {pendingAction === 'steer' ? 'Sending…' : 'Steer'}
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
