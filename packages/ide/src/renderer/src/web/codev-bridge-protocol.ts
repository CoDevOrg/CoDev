export type CodevBridgeStatus = 'connected' | 'reconnecting' | 'disconnected'

export type CodevBridgeSnapshot = {
  status: CodevBridgeStatus
  label: string
  detail: string
}

/**
 * A parent-initiated action, distinct from `CodevBridgeRequestMethod`
 * (IDE-initiated requests the parent replies to). `terminal-run` opens a
 * plain terminal tab and queues `command` as its startup text, the same
 * primitive `runQuickCommandInNewTab` uses for a stored quick command,
 * bypassing agent/session-option composition entirely so the exact text
 * the parent sent is what runs.
 */
export type CodevBridgeCommand = {
  kind: 'terminal-run'
  command: string
  label?: string
}

export type CodevBridgeParentMessage =
  | { type: 'codev:bridge-hello-ack'; generation: number; workspaceBound: true }
  | { type: 'codev:bridge-pong'; generation: number }
  | { type: 'codev:bridge-command'; generation: number; command: CodevBridgeCommand }
  | {
      type: 'codev:bridge-response'
      generation: number
      requestId: string
      ok: boolean
      result?: unknown
      error?: string
    }

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
  | 'agents.startControlled'
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
  | 'profile.get'
  | 'team.roster'
  | 'team.channels'
  | 'team.messages'
  | 'team.send'
  | 'team.createChannel'
  | 'team.saveStatus'

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
  return message.type === 'codev:bridge-pong'
}

function isCodevBridgeCommand(value: unknown): value is CodevBridgeCommand {
  if (!value || typeof value !== 'object') {
    return false
  }
  const command = value as { kind?: unknown; command?: unknown; label?: unknown }
  return (
    command.kind === 'terminal-run' &&
    typeof command.command === 'string' &&
    command.command.trim().length > 0 &&
    (command.label === undefined || typeof command.label === 'string')
  )
}
