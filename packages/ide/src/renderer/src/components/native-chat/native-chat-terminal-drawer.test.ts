import { describe, expect, it, vi } from 'vitest'
import { handleTerminalDrawerSetupFailure } from './native-chat-terminal-drawer'

describe('handleTerminalDrawerSetupFailure', () => {
  it('ignores the expected snapshot rejection after the drawer is disposed', () => {
    const setUnavailable = vi.fn()
    const reportError = vi.fn()

    handleTerminalDrawerSetupFailure(
      new Error('Remote terminal stream closed.'),
      true,
      setUnavailable,
      reportError
    )

    expect(setUnavailable).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
  })

  it('surfaces setup failures while the drawer is still mounted', () => {
    const setUnavailable = vi.fn()
    const reportError = vi.fn()
    const error = new Error('connection failed')

    handleTerminalDrawerSetupFailure(error, false, setUnavailable, reportError)

    expect(setUnavailable).toHaveBeenCalledWith(true)
    expect(reportError).toHaveBeenCalledWith('[native-chat-terminal-drawer] setup failed', error)
  })
})
