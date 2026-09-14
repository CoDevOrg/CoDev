import type { CodevBridgeSnapshot } from './codev-bridge-protocol'
import type { CodevRuntimeReachability } from './codev-runtime-reachability'

/**
 * The status bar speaks for the whole workspace link: the parent-page bridge
 * and the runtime socket behind it. A green "Connected" while every runtime
 * socket failed told members their messages were going somewhere.
 */
export function codevConnectionSnapshot(
  bridge: CodevBridgeSnapshot,
  runtime: CodevRuntimeReachability
): { snapshot: CodevBridgeSnapshot; bridgeActionable: boolean } {
  if (bridge.status !== 'connected' || runtime === 'connected') {
    return { snapshot: bridge, bridgeActionable: true }
  }
  if (runtime === 'unreachable') {
    return {
      snapshot: {
        status: 'disconnected',
        label: 'CoDev · Workspace unreachable',
        detail: "Can't reach this workspace right now. Retrying automatically."
      },
      bridgeActionable: false
    }
  }
  return {
    snapshot: {
      status: 'reconnecting',
      label: 'CoDev · Connecting',
      detail: 'Connecting to this workspace.'
    },
    bridgeActionable: false
  }
}
