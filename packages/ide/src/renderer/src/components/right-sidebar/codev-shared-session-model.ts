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

export type CodevSharedSessionProviderEvent = {
  id: string
  kind: string
  label: string
  detail: string
  turnId: string | null
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
  providerEvents?: CodevSharedSessionProviderEvent[]
  capabilities?: CodevProviderCapabilityFlags
  availableProviders?: CodevProviderCapabilityFlags[]
  providerBoundaries?: CodevSharedProviderBoundary[]
}

export type CodevSharedSessionSnapshot = {
  viewer?: { id: string; name: string; canCoSteer: boolean }
  sharedSessions?: CodevSharedSessionView[]
}

export function fallbackCapabilities(view: CodevSharedSessionView): CodevProviderCapabilityFlags {
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

export function stateLabel(view: CodevSharedSessionView): string {
  const { state, queue } = view.session
  if (state === 'running') {
    return 'Running · CoDev turn'
  }
  if (state === 'interrupted') {
    return 'Interrupted · CoDev turn'
  }
  if (queue.length > 0) {
    return 'Queued · awaiting turn'
  }
  if (view.transcript.length > 0) {
    return `Completed · ${view.transcript.length} turns`
  }
  return 'Idle · awaiting instruction'
}

export function statusMessage(
  connected: boolean,
  restored: boolean,
  view: CodevSharedSessionView | null,
  viewerName: string
): string {
  if (!connected) {
    return 'Waiting for the workspace-bound CoDev bridge.'
  }
  if (view?.connectionBlocked) {
    return view.connectionBlocked
  }
  if (!view) {
    return 'Start a CoDev agent from the workboard or New CoDev agent to open a shared session.'
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
    return 'The CoDev turn was interrupted; the last completed action remains visible to every member.'
  }
  if (view.session.state === 'running') {
    return `${viewerName} can interrupt the running turn with co-steer permission.`
  }
  return 'Shared session is open and idle with an empty ordered queue.'
}
