// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CODEV_OPEN_TERMINAL_DRAWER_EVENT,
  requestCodevTerminalDrawerOpen
} from './codev-terminal-drawer-event'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('requestCodevTerminalDrawerOpen', () => {
  it('dispatches a worktree-scoped request with the exact chat tab when provided', () => {
    const listener = vi.fn()
    window.addEventListener(CODEV_OPEN_TERMINAL_DRAWER_EVENT, listener)

    requestCodevTerminalDrawerOpen('worktree-1', 'chat-tab-1')

    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      detail: { worktreeId: 'worktree-1', terminalTabId: 'chat-tab-1' }
    })
    window.removeEventListener(CODEV_OPEN_TERMINAL_DRAWER_EVENT, listener)
  })

  it('does not dispatch an unscoped request', () => {
    const listener = vi.fn()
    window.addEventListener(CODEV_OPEN_TERMINAL_DRAWER_EVENT, listener)

    requestCodevTerminalDrawerOpen('  ')

    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(CODEV_OPEN_TERMINAL_DRAWER_EVENT, listener)
  })
})
