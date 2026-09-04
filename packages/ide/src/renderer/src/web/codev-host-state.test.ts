// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getCodevHostState,
  installCodevHostStateListener,
  resetCodevHostStateForTest,
  subscribeCodevHostState
} from './codev-host-state'

afterEach(() => {
  resetCodevHostStateForTest()
})

function post(data: unknown, origin = window.location.origin): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }))
}

describe('codev host state', () => {
  it('is unknown until the parent reports', () => {
    installCodevHostStateListener()
    expect(getCodevHostState()).toBeNull()
  })

  it('records a starting host and its slow flag', () => {
    installCodevHostStateListener()
    post({ type: 'codev:host-state', phase: 'starting', slow: false })
    expect(getCodevHostState()).toEqual({ phase: 'starting', slow: false })
    post({ type: 'codev:host-state', phase: 'starting', slow: true })
    expect(getCodevHostState()).toEqual({ phase: 'starting', slow: true })
    post({ type: 'codev:host-state', phase: 'ready', slow: false })
    expect(getCodevHostState()).toEqual({ phase: 'ready', slow: false })
  })

  it('ignores foreign origins and malformed reports', () => {
    installCodevHostStateListener()
    post({ type: 'codev:host-state', phase: 'starting' }, 'https://evil.example')
    post({ type: 'codev:host-state', phase: 'nonsense' })
    post({ type: 'codev:pair', phase: 'starting' })
    post('starting')
    expect(getCodevHostState()).toBeNull()
  })

  it('notifies subscribers only on a real change', () => {
    installCodevHostStateListener()
    const listener = vi.fn()
    const unsubscribe = subscribeCodevHostState(listener)

    post({ type: 'codev:host-state', phase: 'starting', slow: false })
    post({ type: 'codev:host-state', phase: 'starting', slow: false })
    expect(listener).toHaveBeenCalledTimes(1)

    post({ type: 'codev:host-state', phase: 'ready', slow: false })
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
  })

  it('installs its listener only once', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')
    installCodevHostStateListener()
    installCodevHostStateListener()
    expect(addEventListener).toHaveBeenCalledTimes(1)
    addEventListener.mockRestore()
  })
})
