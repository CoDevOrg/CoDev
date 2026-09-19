// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyCodevProviderReadiness,
  getCodevProviderReadiness,
  installCodevProviderReadinessListener,
  isAgentSendBlocked,
  requestCodevProviderReadinessRefresh,
  resetCodevProviderReadinessForTest,
  setCodevProviderReadinessForTest
} from './codev-provider-readiness'

afterEach(() => {
  resetCodevProviderReadinessForTest()
  vi.restoreAllMocks()
})

describe('isAgentSendBlocked', () => {
  /**
   * The desktop app and any parent serving an older bundle never report. If
   * silence counted as "not ready" the composer would lock everywhere off the
   * CoDev workspace surface.
   */
  it('does not block when the parent has said nothing', () => {
    expect(isAgentSendBlocked(null)).toBe(false)
  })

  it('blocks only when the parent says no provider can run here', () => {
    expect(
      isAgentSendBlocked({ ready: false, agent: null, reason: 'nope', settingsHref: null })
    ).toBe(true)
    expect(
      isAgentSendBlocked({ ready: true, agent: 'claude', reason: null, settingsHref: null })
    ).toBe(false)
  })
})

describe('installCodevProviderReadinessListener', () => {
  it('ignores a report from another origin', () => {
    installCodevProviderReadinessListener()
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example',
        data: { type: 'codev:provider-readiness', ready: false, reason: 'injected' }
      })
    )
    expect(getCodevProviderReadiness()).toBeNull()
  })

  it('ignores a message that is not a readiness report', () => {
    installCodevProviderReadinessListener()
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'codev:host-state', phase: 'ready' }
      })
    )
    expect(getCodevProviderReadiness()).toBeNull()
  })

  it('records a well-formed report from the parent', () => {
    installCodevProviderReadinessListener()
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'codev:provider-readiness',
          ready: false,
          agent: null,
          reason: 'No coding agent is set up for this workspace yet.',
          settingsHref: '/settings/personal/providers#coding-workspaces'
        }
      })
    )
    expect(getCodevProviderReadiness()).toEqual({
      ready: false,
      agent: null,
      reason: 'No coding agent is set up for this workspace yet.',
      settingsHref: '/settings/personal/providers#coding-workspaces',
      providers: { claude: false, codex: false }
    })
  })

  it('drops a report with no boolean verdict rather than guessing one', () => {
    installCodevProviderReadinessListener()
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'codev:provider-readiness', reason: 'half a message' }
      })
    )
    expect(getCodevProviderReadiness()).toBeNull()
  })
})

describe('setCodevProviderReadinessForTest', () => {
  it('notifies subscribers so the composer re-renders', () => {
    setCodevProviderReadinessForTest({
      ready: false,
      agent: null,
      reason: 'blocked',
      settingsHref: null
    })
    expect(isAgentSendBlocked(getCodevProviderReadiness())).toBe(true)
  })
})

describe('applyCodevProviderReadiness', () => {
  it('unblocks send after a local connect without waiting for the parent', () => {
    applyCodevProviderReadiness({
      ready: false,
      agent: null,
      reason: 'blocked',
      settingsHref: null
    })
    applyCodevProviderReadiness({
      ready: true,
      agent: 'claude',
      reason: null,
      settingsHref: null
    })
    expect(getCodevProviderReadiness()).toMatchObject({ ready: true, agent: 'claude' })
    expect(isAgentSendBlocked(getCodevProviderReadiness())).toBe(false)
  })
})

describe('requestCodevProviderReadinessRefresh', () => {
  it('asks the parent to re-read connections when this window is nested', () => {
    const postMessage = vi.fn()
    const parent = { postMessage } as unknown as Window
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent)

    requestCodevProviderReadinessRefresh()

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'codev:provider-readiness-refresh' },
      window.location.origin
    )
  })

  it('does not post when this window is the top frame', () => {
    const postMessage = vi.fn()
    vi.spyOn(window, 'parent', 'get').mockReturnValue(window)
    vi.spyOn(window, 'postMessage').mockImplementation(postMessage)

    requestCodevProviderReadinessRefresh()

    expect(postMessage).not.toHaveBeenCalled()
  })
})
