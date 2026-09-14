import { describe, expect, it } from 'vitest'
import type { CodevBridgeSnapshot } from './codev-bridge-protocol'
import { codevConnectionSnapshot } from './codev-connection-status'

const connected: CodevBridgeSnapshot = {
  status: 'connected',
  label: 'CoDev · Connected',
  detail: 'Workspace-bound request bridge is connected.'
}

describe('codevConnectionSnapshot', () => {
  it('reports Connected only when the runtime socket is up too', () => {
    expect(codevConnectionSnapshot(connected, 'connected')).toEqual({
      snapshot: connected,
      bridgeActionable: true
    })
  })

  it('does not claim Connected while the runtime is unreachable', () => {
    const { snapshot, bridgeActionable } = codevConnectionSnapshot(connected, 'unreachable')
    expect(snapshot.status).toBe('disconnected')
    expect(snapshot.label).toBe('CoDev · Workspace unreachable')
    expect(bridgeActionable).toBe(false)
  })

  it('shows Connecting while the runtime socket is still coming up', () => {
    expect(codevConnectionSnapshot(connected, 'connecting').snapshot.status).toBe('reconnecting')
  })

  it('lets a broken bridge speak for itself', () => {
    const bridge: CodevBridgeSnapshot = {
      status: 'disconnected',
      label: 'CoDev · Disconnected',
      detail: 'Workspace-bound request bridge is interrupted.'
    }
    expect(codevConnectionSnapshot(bridge, 'unreachable')).toEqual({
      snapshot: bridge,
      bridgeActionable: true
    })
  })
})
