import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getCodevRuntimeReachability,
  reportCodevRuntimeClientState,
  resetCodevRuntimeReachability,
  subscribeCodevRuntimeReachability
} from './codev-runtime-reachability'

afterEach(() => {
  resetCodevRuntimeReachability()
})

describe('codev runtime reachability', () => {
  it('starts out connecting and turns connected once the socket lands', () => {
    expect(getCodevRuntimeReachability()).toBe('connecting')
    reportCodevRuntimeClientState('connecting')
    reportCodevRuntimeClientState('handshaking')
    reportCodevRuntimeClientState('connected')
    expect(getCodevRuntimeReachability()).toBe('connected')
  })

  it('tolerates one dropped attempt but reports a repeated failure as unreachable', () => {
    reportCodevRuntimeClientState('connecting')
    reportCodevRuntimeClientState('disconnected')
    expect(getCodevRuntimeReachability()).toBe('connecting')
    reportCodevRuntimeClientState('connecting')
    reportCodevRuntimeClientState('disconnected')
    expect(getCodevRuntimeReachability()).toBe('unreachable')
  })

  it('stays unreachable through a retry until the retry connects', () => {
    reportCodevRuntimeClientState('disconnected')
    reportCodevRuntimeClientState('disconnected')
    reportCodevRuntimeClientState('connecting')
    expect(getCodevRuntimeReachability()).toBe('unreachable')
    reportCodevRuntimeClientState('connected')
    expect(getCodevRuntimeReachability()).toBe('connected')
  })

  it('treats a rejected pairing as unreachable immediately', () => {
    reportCodevRuntimeClientState('auth-failed')
    expect(getCodevRuntimeReachability()).toBe('unreachable')
  })

  it('notifies subscribers only on a change', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCodevRuntimeReachability(listener)
    reportCodevRuntimeClientState('connecting')
    reportCodevRuntimeClientState('connected')
    reportCodevRuntimeClientState('connected')
    unsubscribe()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
