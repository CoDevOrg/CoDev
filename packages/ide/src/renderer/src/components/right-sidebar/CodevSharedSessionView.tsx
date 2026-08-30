import type { JSX } from 'react'
import { Button } from '@/components/ui/button'

export type CodevSharedQueueEntry = {
  id: string
  authorId: string
  authorName?: string
  prompt: string
  queuePosition: number
}

export type CodevSharedTranscriptTurn = {
  position: number
  turnId: string
  authorId: string
  authorName: string
  prompt: string
  status: 'completed' | 'interrupted' | 'failed'
  tool: string | null
  output: string | null
  provider?: string
  providerLabel?: string
}

export type CodevSharedProviderBoundary = {
  id: string
  from: string
  to: string
  fromLabel: string
  toLabel: string
  afterTurnId: string | null
  label: string
}

export type CodevProviderCapabilityFlags = {
  id: string
  label: string
  selected: boolean
  canQueue: boolean
  canInterrupt: boolean
  canStartControlled: boolean
  queueUnavailable: string | null
  interruptUnavailable: string | null
  startControlledUnavailable: string | null
}

export type CodevSharedSessionView = {
  session: {
    sessionId: string
    ownerId: string
    worktreeId: string
    provider: string
    model: string
    state: string
    activeTurnId: string | null
    streamCursor: number
    queue: CodevSharedQueueEntry[]
  }
  name: string
  ownerName: string
  worktreeName: string
  model: string
  attributedQueue?: CodevSharedQueueEntry[]
  transcript: CodevSharedTranscriptTurn[]
  lastCompletedAction: { tool: string; output: string } | null
  connectionBlocked?: string | null
  providerEvents?: Array<{
    id: string
    kind: string
    label: string
    detail: string
    turnId: string | null
  }>
  capabilities?: CodevProviderCapabilityFlags
  availableProviders?: CodevProviderCapabilityFlags[]
  providerBoundaries?: CodevSharedProviderBoundary[]
}

export type CodevSharedSessionSnapshot = {
  viewer?: { id: string; name: string; canCoSteer: boolean }
  sharedSessions?: CodevSharedSessionView[]
}

function fallbackCapabilities(view: CodevSharedSessionView): CodevProviderCapabilityFlags {
  return {
    id: view.session.provider,
    label: view.session.provider,
    selected: true,
    canQueue: true,
    canInterrupt: true,
    canStartControlled: true,
    queueUnavailable: null,
    interruptUnavailable: null,
    startControlledUnavailable: null
  }
}

function stateLabel(view: CodevSharedSessionView): string {
  const { state, queue } = view.session
  if (state === 'running') return 'Running · controlled turn'
  if (state === 'interrupted') return 'Interrupted · controlled turn'
  if (queue.length > 0) return 'Queued · awaiting turn'
  if (view.transcript.length > 0) {
    return `Completed · ${view.transcript.length} turns`
  }
  return 'Idle · awaiting instruction'
}

function statusMessage(
  connected: boolean,
  restored: boolean,
  view: CodevSharedSessionView | null,
  viewerName: string
): string {
  if (!connected) return 'Waiting for the workspace-bound CoDev bridge.'
  if (view?.connectionBlocked) return view.connectionBlocked
  if (!view) {
    return 'Prepare a managed proposal from this Agents panel to open a shared session.'
  }
  const queue = view.session.queue
  if (restored) {
    return `Session restored after browser refresh · stream cursor ${view.session.streamCursor} · ${
      queue.length > 0
        ? 'queued instruction preserved once.'
        : 'transcript replayed without duplicate turns.'
    }`
  }
  if (queue.length > 0) {
    return `${queue.length === 1 ? "Collaborator's instruction is" : 'Queued instructions are'} queued and attributed for every session member.`
  }
  if (view.session.state === 'interrupted') {
    return 'The controlled turn was interrupted; the last completed action remains visible to every member.'
  }
  if (view.session.state === 'running') {
    return `${viewerName} can interrupt the running turn with co-steer permission.`
  }
  return 'Shared session is open and idle with an empty ordered queue.'
}

export function CodevSharedSessionViewPanel({
  connected,
  restored,
  viewer,
  view,
  draftPrompt,
  busy,
  message,
  onDraftChange,
  onRefresh,
  onStartControlled,
  onQueue,
  onInterrupt,
  onSelectProvider
}: {
  connected: boolean
  restored: boolean
  viewer: { id: string; name: string; canCoSteer: boolean } | null
  view: CodevSharedSessionView | null
  draftPrompt: string
  busy: string
  message: string
  onDraftChange: (value: string) => void
  onRefresh: () => void
  onStartControlled: () => void
  onQueue: () => void
  onInterrupt: () => void
  onSelectProvider?: (provider: string) => void
}): JSX.Element {
  const canCoSteer = Boolean(viewer?.canCoSteer)
  const queue = view?.attributedQueue ?? view?.session.queue ?? []
  const queued = queue[0] ?? null
  const running = view?.session.state === 'running'
  const interrupted = view?.session.state === 'interrupted'
  const capabilities = view ? (view.capabilities ?? fallbackCapabilities(view)) : null
  const availableProviders = view?.availableProviders ?? (capabilities ? [capabilities] : [])
  const canQueue = Boolean(canCoSteer && capabilities?.canQueue)
  const canInterrupt = Boolean(canCoSteer && capabilities?.canInterrupt)
  const canStart = Boolean(canCoSteer && capabilities?.canStartControlled)

  return (
    <section
      className="border-b border-sidebar-border px-3 py-3"
      aria-labelledby="codev-shared-session-heading"
      data-codev-shared-session="true"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            CoDev · durable shared session
          </p>
          <h2 id="codev-shared-session-heading" className="text-sm font-semibold">
            Shared session
          </h2>
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={busy === 'refresh'} onClick={onRefresh}>
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh shared session'}
        </Button>
      </div>

      {!view ? (
        <p className="text-xs text-muted-foreground">
          Prepare a managed proposal from this Agents panel to open a shared session. The shared
          context is this visible conversation and repository state, not provider credentials.
        </p>
      ) : (
        <div className="space-y-3">
          <div
            className="grid grid-cols-2 gap-2 text-xs"
            aria-label="Session metadata"
          >
            <div>
              <span className="block text-[10px] uppercase text-muted-foreground">Provider</span>
              <strong>{capabilities?.label ?? view.session.provider}</strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase text-muted-foreground">Owner</span>
              <strong>{view.ownerName}</strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase text-muted-foreground">Worktree</span>
              <code>{view.worktreeName}</code>
            </div>
            <div>
              <span className="block text-[10px] uppercase text-muted-foreground">State</span>
              <strong>{stateLabel(view)}</strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase text-muted-foreground">
                Model / configuration
              </span>
              <strong>{view.model} · standard</strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase text-muted-foreground">Stream cursor</span>
              <strong>{view.session.streamCursor}</strong>
            </div>
          </div>

          <div aria-label="Provider capabilities" className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[10px] uppercase text-muted-foreground">
                Provider capabilities
              </span>
              <strong>{availableProviders.length} providers</strong>
            </div>
            {availableProviders.map((provider) => (
              <div
                key={provider.id}
                className="rounded-md border border-sidebar-border p-2 text-xs"
                data-codev-provider-capability={provider.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong>{provider.label}</strong>
                  {provider.selected ? (
                    <span>Current provider</span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canCoSteer || running || busy !== ''}
                      aria-label={`Use ${provider.label}`}
                      onClick={() => onSelectProvider?.(provider.id)}
                    >
                      Use {provider.label}
                    </Button>
                  )}
                </div>
                <p className="mt-1">
                  Queue · {provider.canQueue ? 'available' : 'unavailable'}
                </p>
                <p>Interrupt · {provider.canInterrupt ? 'available' : 'unavailable'}</p>
                <p>
                  Controlled turns · {provider.canStartControlled ? 'available' : 'unavailable'}
                </p>
                {provider.selected && provider.queueUnavailable ? (
                  <p className="mt-1" aria-label="Unavailable control">
                    {provider.queueUnavailable}
                  </p>
                ) : null}
                {provider.selected && provider.interruptUnavailable ? (
                  <p aria-label="Unavailable control">{provider.interruptUnavailable}</p>
                ) : null}
              </div>
            ))}
          </div>

          <div aria-label="Ordered turn queue" className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[10px] uppercase text-muted-foreground">Ordered turn queue</span>
              <strong>{queue.length} queued</strong>
            </div>
            {!queued ? (
              <p className="text-xs text-muted-foreground">
                {view.transcript.length > 0
                  ? 'Queue is empty — the completed transcript is shown below.'
                  : 'Queue is empty — no instructions are waiting.'}
              </p>
            ) : (
              <div className="rounded-md border border-sidebar-border p-2 text-xs" aria-label="Queued instruction">
                <div className="flex justify-between gap-2">
                  <span>Turn {queued.queuePosition}</span>
                  <strong>
                    {'authorName' in queued && queued.authorName
                      ? queued.authorName
                      : viewer?.id === queued.authorId
                        ? viewer.name
                        : 'Collaborator'}
                  </strong>
                </div>
                <p className="mt-1">{queued.prompt}</p>
                <p className="mt-1 text-muted-foreground">
                  Attribution · <code>authorId {queued.authorId}</code>
                </p>
              </div>
            )}
          </div>

          <div aria-label="Controlled shared-session turn" className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[10px] uppercase text-muted-foreground">Controlled turn</span>
              <strong>
                {running ? 'Running' : interrupted ? 'Interrupted' : 'Ready to run'}
              </strong>
            </div>
            {running || interrupted ? (
              <>
                <p className="text-xs" aria-live="polite">
                  {running
                    ? 'Tool activity · write_file · waiting for completion.'
                    : 'Cancellation recorded. No further tool calls will run.'}
                </p>
                {view.lastCompletedAction ? (
                  <div
                    className="rounded-md border border-sidebar-border p-2 text-xs"
                    aria-label="Last completed action"
                  >
                    <span className="block text-[10px] uppercase text-muted-foreground">
                      Last completed action
                    </span>
                    <strong>{view.lastCompletedAction.tool}</strong>
                    <p>{view.lastCompletedAction.output}</p>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Start a controlled turn with one completed tool result so an eligible collaborator can
                cancel it without calling the provider again.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canStart || running || busy !== ''}
                onClick={onStartControlled}
              >
                {canStart ? 'Start controlled turn' : 'Start controlled turn · unavailable'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canInterrupt || !running || busy !== ''}
                onClick={onInterrupt}
              >
                {!canInterrupt
                  ? 'Interrupt turn · unavailable'
                  : interrupted
                    ? 'Turn interrupted'
                    : 'Interrupt running turn'}
              </Button>
            </div>
            {capabilities?.interruptUnavailable ? (
              <p className="text-xs text-muted-foreground" aria-label="Unavailable control">
                {capabilities.interruptUnavailable}
              </p>
            ) : null}
          </div>

          <div aria-label={`${viewer?.name ?? 'Collaborator'} collaborator controls`} className="space-y-2">
            <label className="block text-xs" htmlFor="codev-shared-session-prompt">
              Instruction to queue
            </label>
            <textarea
              id="codev-shared-session-prompt"
              className="min-h-16 w-full rounded-md border border-sidebar-border bg-background px-2 py-1 text-xs"
              value={draftPrompt}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="Ask the shared agent to inspect a file…"
              disabled={!canQueue || queue.length > 0 || busy !== ''}
            />
            <Button
              type="button"
              size="sm"
              disabled={!canQueue || !draftPrompt.trim() || queue.length > 0 || busy !== ''}
              onClick={onQueue}
            >
              {!canQueue
                ? 'Queue instruction · unavailable'
                : queue.length > 0
                  ? 'Instruction queued'
                  : 'Queue instruction'}
            </Button>
            {capabilities?.queueUnavailable ? (
              <p className="text-xs text-muted-foreground" aria-label="Unavailable control">
                {capabilities.queueUnavailable}
              </p>
            ) : null}
          </div>

          {view.transcript.length > 0 ? (
            <div aria-label="Ordered transcript" className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[10px] uppercase text-muted-foreground">Ordered transcript</span>
                <strong>{view.transcript.length} completed turns</strong>
              </div>
              {view.transcript.map((turn) => (
                <div key={turn.turnId} className="space-y-2">
                  <article className="rounded-md border border-sidebar-border p-2 text-xs">
                    <div className="flex justify-between gap-2">
                      <span>Turn {turn.position}</span>
                      <strong>
                        {turn.authorName} · {turn.status}
                        {turn.providerLabel ? ` · ${turn.providerLabel}` : ''}
                      </strong>
                    </div>
                    <p className="mt-1">{turn.prompt}</p>
                    {turn.tool ? (
                      <p className="mt-1 text-muted-foreground">
                        Tool activity · <code>{turn.tool}</code>
                      </p>
                    ) : null}
                    {turn.output ? (
                      <p className="mt-1">
                        <span className="text-[10px] uppercase text-muted-foreground">Output</span>
                        {turn.output}
                      </p>
                    ) : null}
                  </article>
                  {(view.providerBoundaries ?? [])
                    .filter((boundary) => boundary.afterTurnId === turn.turnId)
                    .map((boundary) => (
                      <p
                        key={boundary.id}
                        className="rounded-md border border-dashed border-sidebar-border px-2 py-1 text-xs"
                        aria-label="Provider boundary"
                        data-codev-provider-boundary={`${boundary.from}-to-${boundary.to}`}
                      >
                        {boundary.label}
                      </p>
                    ))}
                </div>
              ))}
            </div>
          ) : null}

          {(view.providerEvents ?? []).length > 0 ? (
            <div aria-label="Standardized provider events" className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[10px] uppercase text-muted-foreground">
                  Standardized events
                </span>
                <strong>{view.providerEvents?.length} events</strong>
              </div>
              <ol className="space-y-1">
                {(view.providerEvents ?? []).map((event) => (
                  <li
                    key={event.id}
                    className="rounded-md border border-sidebar-border px-2 py-1 text-xs"
                    data-codev-provider-event={event.kind}
                  >
                    <strong className="uppercase tracking-wide text-[10px] text-muted-foreground">
                      {event.label}
                    </strong>
                    <p>{event.detail}</p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <p className="text-[11px] text-muted-foreground">
            Shared context is the visible session transcript and repository state. No provider
            credentials or hidden account context are shared.
          </p>
        </div>
      )}

      <p
        className="mt-2 text-xs text-muted-foreground"
        role={view?.connectionBlocked || message ? 'alert' : 'status'}
        aria-label={
          view?.connectionBlocked || /revoked or is not connected/i.test(message)
            ? 'Provider connection blocked'
            : 'Shared session status'
        }
      >
        {message || statusMessage(connected, restored, view, viewer?.name ?? 'You')}
      </p>
    </section>
  )
}
