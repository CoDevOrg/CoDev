import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getState: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: { getState: mocks.getState }
}))

import { supersedeWorktreeAgentTabs } from './codev-retire-superseded-chat'

function state(tabs: { id: string; launchAgent?: string }[], closeTab = vi.fn()) {
  return { tabsByWorktree: { 'wt-1': tabs }, unifiedTabsByWorktree: {}, closeTab }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  mocks.getState.mockReset()
})

describe('supersedeWorktreeAgentTabs', () => {
  it('closes the agent tab the resumed chat replaced, once the new one exists', () => {
    const closeTab = vi.fn()
    mocks.getState.mockReturnValue(state([{ id: 'old', launchAgent: 'claude' }], closeTab))
    const retire = supersedeWorktreeAgentTabs('wt-1')

    // The replacement lands only after the launch, as it does on a paired host.
    mocks.getState.mockReturnValue(
      state([{ id: 'old', launchAgent: 'claude' }, { id: 'new', launchAgent: 'claude' }], closeTab)
    )
    retire()
    vi.advanceTimersByTime(2_000)

    expect(closeTab).toHaveBeenCalledTimes(1)
    expect(closeTab).toHaveBeenCalledWith('old', { reason: 'user' })
  })

  it('waits for the replacement rather than leaving the worktree agentless', () => {
    const closeTab = vi.fn()
    mocks.getState.mockReturnValue(state([{ id: 'old', launchAgent: 'claude' }], closeTab))
    const retire = supersedeWorktreeAgentTabs('wt-1')
    retire()

    // The launch never produced a tab; nothing may be closed.
    vi.advanceTimersByTime(60_000)
    expect(closeTab).not.toHaveBeenCalled()
  })

  it('does nothing when the worktree had no agent to supersede', () => {
    const closeTab = vi.fn()
    mocks.getState.mockReturnValue(state([{ id: 'shell' }], closeTab))
    const retire = supersedeWorktreeAgentTabs('wt-1')

    mocks.getState.mockReturnValue(state([{ id: 'new', launchAgent: 'claude' }], closeTab))
    retire()
    vi.advanceTimersByTime(10_000)

    expect(closeTab).not.toHaveBeenCalled()
  })
})
