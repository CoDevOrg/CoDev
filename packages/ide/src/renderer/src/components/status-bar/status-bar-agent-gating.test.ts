import { describe, expect, it } from 'vitest'
import { isStatusBarItemAvailable } from './status-bar-agent-gating'

describe('isStatusBarItemAvailable', () => {

  it('keeps CLI items visible while detection is in flight', () => {
    // Why: pre-detection (null) we don't yet know what the user has, so we
    // don't want a flash of empty status bar on cold start.
    expect(isStatusBarItemAvailable('claude', null)).toBe(true)
    expect(isStatusBarItemAvailable('codex', null)).toBe(true)
  })

  it('hides CLI items not detected on PATH', () => {
    expect(isStatusBarItemAvailable('claude', [])).toBe(false)
    expect(isStatusBarItemAvailable('codex', ['claude'])).toBe(false)
  })

  it('shows CLI items detected on PATH', () => {
    expect(isStatusBarItemAvailable('claude', ['claude'])).toBe(true)
    expect(isStatusBarItemAvailable('codex', ['codex', 'claude'])).toBe(true)
  })
})
