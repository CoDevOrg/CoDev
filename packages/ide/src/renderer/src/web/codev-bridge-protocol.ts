/**
 * The wire protocol between the embedded IDE (this package) and the CoDev
 * parent page (`apps/web/components/workspace/codev-parent-bridge.ts`).
 *
 * This file is the single definition of every message both sides exchange.
 * `apps/web` imports these types with `import type`, which is erased at
 * compile time, so nothing from this package is bundled into the web app but
 * `apps/web`'s typecheck fails the moment the two sides disagree. Keep it
 * free of imports so it type-checks under both packages' compiler settings.
 */

export type CodevBridgeStatus = 'connected' | 'reconnecting' | 'disconnected'

export type CodevBridgeSnapshot = {
  status: CodevBridgeStatus
  label: string
  detail: string
}

export type CodevWorkspaceRealtimeEvent = {
  workspaceId: string
  type: string
  payload: Record<string, unknown>
  createdAt: string
}

export type CodevWorkspaceStreamStatus = 'connected' | 'reconnecting' | 'unavailable'

export type CodevWorkspaceEventMessage = {
  type: 'codev:workspace-event'
  generation: number
  cursor: string
  event: CodevWorkspaceRealtimeEvent
}

export type CodevWorkspaceStreamStatusMessage = {
  type: 'codev:workspace-stream-status'
  generation: number
  status: CodevWorkspaceStreamStatus
}

/**
 * A parent-initiated action, distinct from `CodevBridgeRequestMethod`
 * (IDE-initiated requests the parent replies to). `terminal-run` opens a
 * terminal tab and queues `command` as its startup text, the same primitive
 * `runQuickCommandInNewTab` uses for a stored quick command, bypassing
 * agent/session-option composition entirely so the exact text the parent
 * sent is what runs.
 *
 * `agent`, when it names a native-chat-supported agent, opens that tab in
 * chat view (tagged with that launch agent) instead of a plain terminal —
 * CoDev never wants a raw TUI for an agent chat is capable of rendering, even
 * when `command` is a resume/continue invocation rather than the agent's
 * normal launch command. Older hosts that don't know this field simply run
 * `command` in a plain terminal tab, same as before it existed.
 */
export type CodevBridgeCommand = {
  kind: 'terminal-run'
  command: string
  label?: string
  agent?: string
}

export type CodevBridgeCommandMessage = {
  type: 'codev:bridge-command'
  generation: number
  command: CodevBridgeCommand
}

/** The parent's reply to one `CodevBridgeRequestMessage`. */
export type CodevBridgeResponseMessage = {
  type: 'codev:bridge-response'
  generation: number
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}

/** Everything the parent page posts into the IDE iframe. */
export type CodevBridgeParentMessage =
  | { type: 'codev:bridge-hello-ack'; generation: number; workspaceBound: true }
  | { type: 'codev:bridge-pong'; generation: number }
  | CodevBridgeCommandMessage
  | CodevWorkspaceEventMessage
  | CodevWorkspaceStreamStatusMessage
  | CodevBridgeResponseMessage

export type CodevBridgeRequestMethod =
  | 'invites.list'
  | 'invites.create'
  | 'invites.revoke'
  | 'members.update'
  | 'presence.list'
  | 'presence.update'
  | 'presence.cursor.update'
  | 'conflicts.list'
  | 'conflicts.report'
  | 'conflicts.resolve'
  | 'agents.list'
  | 'agents.enqueue'
  | 'agents.interrupt'
  | 'agents.discard'
  | 'agents.startControlled'
  | 'agents.newChat'
  | 'agents.selectProvider'
  | 'workboard.list'
  | 'workboard.create'
  | 'claims.list'
  | 'coordination.list'
  | 'claims.create'
  | 'claims.reassign'
  | 'claims.cancel'
  | 'review.list'
  | 'review.prepare'
  | 'review.advance'
  | 'review.merge'
  | 'activity.list'
  | 'connections.list'
  | 'connections.put'
  | 'connections.revoke'
  | 'claudeConnect.start'
  | 'claudeConnect.submitCode'
  | 'claudeConnect.status'
  | 'profile.get'
  | 'team.roster'
  | 'team.channels'
  | 'team.messages'
  | 'team.send'
  | 'team.createChannel'
  | 'team.saveStatus'

/** An IDE-initiated request the parent answers with a `CodevBridgeResponseMessage`. */
export type CodevBridgeRequestMessage = {
  type: 'codev:bridge-request'
  generation: number
  requestId: string
  method: CodevBridgeRequestMethod
  params?: Record<string, unknown>
}

/** Everything the IDE iframe posts to the parent page. */
export type CodevBridgeClientMessage =
  | { type: 'codev:bridge-hello'; generation: number }
  | { type: 'codev:bridge-ping'; generation: number }
  | { type: 'codev:bridge-interrupt'; generation: number }
  | CodevBridgeRequestMessage

export function isParentMessage(
  data: unknown,
  generation: number
): data is CodevBridgeParentMessage {
  if (!data || typeof data !== 'object' || !('type' in data)) {
    return false
  }
  const message = data as {
    type?: unknown
    generation?: unknown
    workspaceBound?: unknown
    requestId?: unknown
    ok?: unknown
    command?: unknown
    cursor?: unknown
    event?: unknown
    status?: unknown
  }
  if (message.generation !== generation) {
    return false
  }
  if (message.type === 'codev:bridge-hello-ack') {
    return message.workspaceBound === true
  }
  if (message.type === 'codev:bridge-response') {
    return typeof message.requestId === 'string' && typeof message.ok === 'boolean'
  }
  if (message.type === 'codev:bridge-command') {
    return isCodevBridgeCommand(message.command)
  }
  if (message.type === 'codev:workspace-event') {
    return typeof message.cursor === 'string' && isCodevWorkspaceRealtimeEvent(message.event)
  }
  if (message.type === 'codev:workspace-stream-status') {
    return (
      message.status === 'connected' ||
      message.status === 'reconnecting' ||
      message.status === 'unavailable'
    )
  }
  return message.type === 'codev:bridge-pong'
}

function isCodevWorkspaceRealtimeEvent(value: unknown): value is CodevWorkspaceRealtimeEvent {
  if (!value || typeof value !== 'object') {
    return false
  }
  const event = value as {
    workspaceId?: unknown
    type?: unknown
    payload?: unknown
    createdAt?: unknown
  }
  return (
    typeof event.workspaceId === 'string' &&
    event.workspaceId.length > 0 &&
    typeof event.type === 'string' &&
    event.type.length > 0 &&
    Boolean(event.payload) &&
    typeof event.payload === 'object' &&
    !Array.isArray(event.payload) &&
    typeof event.createdAt === 'string'
  )
}

function isCodevBridgeCommand(value: unknown): value is CodevBridgeCommand {
  if (!value || typeof value !== 'object') {
    return false
  }
  const command = value as { kind?: unknown; command?: unknown; label?: unknown; agent?: unknown }
  return (
    command.kind === 'terminal-run' &&
    typeof command.command === 'string' &&
    command.command.trim().length > 0 &&
    (command.label === undefined || typeof command.label === 'string') &&
    (command.agent === undefined || typeof command.agent === 'string')
  )
}
