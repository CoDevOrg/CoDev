import { parsePaneKey } from '../../../shared/stable-pane-id'
import { parseRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'

export type AgentStatusConnectionRouting = { connectionId: string | null }

type AgentStatusRoutingState = {
  terminalLayoutsByTabId:
    | Record<string, { ptyIdsByLeafId?: Record<string, string | undefined> } | undefined>
    | undefined
  ptyIdsByTabId: Record<string, string[] | undefined> | undefined
  transientClearedAgentStatusConnectionIds: Record<string, true>
}

export function resolveAgentStatusConnectionRouting(args: {
  ptyId: string | null | undefined
  expectedConnectionId?: string | null
  runtimeEnvironmentId?: string | null
}): AgentStatusConnectionRouting | undefined {
  const ptyId = args.ptyId?.trim()
  if (!ptyId) {
    return undefined
  }
  const expectedConnectionId = args.expectedConnectionId?.trim() || args.expectedConnectionId

  const runtimePty = parseRemoteRuntimePtyId(ptyId)
  if (runtimePty?.handle) {
    if (
      typeof expectedConnectionId === 'string' ||
      args.runtimeEnvironmentId === null ||
      (typeof args.runtimeEnvironmentId === 'string' &&
        runtimePty.environmentId !== null &&
        runtimePty.environmentId !== args.runtimeEnvironmentId)
    ) {
      return undefined
    }
    return { connectionId: null }
  }
  if (ptyId.startsWith('remote:')) {
    return undefined
  }

  // Why: remote-runtime PTY IDs are namespaced; a remaining concrete PTY is
  // authoritative local/WSL ownership.
  if (typeof expectedConnectionId === 'string') {
    return undefined
  }
  return { connectionId: null }
}

export function resolveLiveAgentStatusConnectionRouting(args: {
  state: AgentStatusRoutingState
  paneKey: string
  ptyId: string
  expectedConnectionId?: string | null
  runtimeEnvironmentId?: string | null
}): AgentStatusConnectionRouting | undefined {
  const pane = parsePaneKey(args.paneKey)
  if (
    !pane ||
    !args.state.ptyIdsByTabId?.[pane.tabId]?.includes(args.ptyId) ||
    args.state.terminalLayoutsByTabId?.[pane.tabId]?.ptyIdsByLeafId?.[pane.leafId] !== args.ptyId
  ) {
    return undefined
  }
  const routing = resolveAgentStatusConnectionRouting(args)
  if (!routing) {
    return undefined
  }
  // Why: a transient clear drops statuses without dropping durable PTY
  // bindings; old renderer callbacks must stay blocked until it lifts.
  if (
    routing.connectionId !== null &&
    routing.connectionId in args.state.transientClearedAgentStatusConnectionIds
  ) {
    return undefined
  }
  return routing
}
