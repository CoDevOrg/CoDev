// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  storedEnvironment: null as unknown
}))

vi.mock('./web-runtime-environment', () => ({
  readStoredWebRuntimeEnvironment: () => mocks.storedEnvironment
}))

import { isCodevPendingShell } from './codev-pending-shell'

afterEach(() => {
  mocks.storedEnvironment = null
  delete window.__CODEV_EMBEDDED__
  delete window.__CODEV_PENDING_SHELL__
  window.location.hash = ''
})

describe('isCodevPendingShell', () => {
  it('is false outside the CoDev embed, flag or not', () => {
    window.__CODEV_PENDING_SHELL__ = true
    expect(isCodevPendingShell()).toBe(false)
  })

  it('follows the flag the web entry point sets', () => {
    window.__CODEV_EMBEDDED__ = true

    window.__CODEV_PENDING_SHELL__ = true
    expect(isCodevPendingShell()).toBe(true)

    window.__CODEV_PENDING_SHELL__ = false
    expect(isCodevPendingShell()).toBe(false)
  })

  it('keeps the flag over a stale stored environment', () => {
    window.__CODEV_EMBEDDED__ = true
    window.__CODEV_PENDING_SHELL__ = true
    // A returning member can still carry an environment from a past session;
    // it must not make the pending shell look paired.
    mocks.storedEnvironment = { id: 'stale' }
    expect(isCodevPendingShell()).toBe(true)
  })

  it('falls back to the missing environment when no flag was set', () => {
    window.__CODEV_EMBEDDED__ = true
    expect(isCodevPendingShell()).toBe(true)
    mocks.storedEnvironment = { id: 'live' }
    expect(isCodevPendingShell()).toBe(false)
  })
})
