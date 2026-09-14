import { beforeEach, describe, expect, it, vi } from 'vitest'

const getState = vi.fn()

vi.mock('@/store', () => ({
  useAppStore: { getState: () => getState() }
}))

import { codevChatTabIdInState, frontCodevChatTab } from './codev-center-chat-tab'

describe('codevChatTabIdInState', () => {
  it('prefers the unified chat-mode tab, which survives the host mirror', () => {
    expect(
      codevChatTabIdInState('wt', {
        tabsByWorktree: { wt: [{ id: 'shell' }, { id: 'term-chat' }] },
        unifiedTabsByWorktree: {
          wt: [
            { id: 'u-shell', entityId: 'shell', viewMode: 'terminal' },
            { id: 'u-chat', entityId: 'term-chat', viewMode: 'chat' }
          ]
        }
      })
    ).toBe('term-chat')
  })

  it('falls back to a tab launched with an agent', () => {
    expect(
      codevChatTabIdInState('wt', {
        tabsByWorktree: { wt: [{ id: 'shell' }, { id: 'agent', launchAgent: 'codex' }] }
      })
    ).toBe('agent')
  })

  it('reports no chat for a worktree holding only shells', () => {
    expect(codevChatTabIdInState('wt', { tabsByWorktree: { wt: [{ id: 'shell' }] } })).toBeNull()
  })
})

describe('frontCodevChatTab', () => {
  const setActiveTabForWorktree = vi.fn()
  const setActiveTab = vi.fn()

  beforeEach(() => {
    setActiveTabForWorktree.mockReset()
    setActiveTab.mockReset()
  })

  const stateWith = (activeWorktreeId: string) => ({
    activeWorktreeId,
    setActiveTabForWorktree,
    setActiveTab,
    tabsByWorktree: { wt: [{ id: 'shell' }, { id: 'chat', launchAgent: 'claude' }] }
  })

  it('moves the center from a shell to the chat', () => {
    getState.mockReturnValue(stateWith('wt'))
    frontCodevChatTab('wt', 'shell')
    expect(setActiveTabForWorktree).toHaveBeenCalledWith('wt', 'chat')
    expect(setActiveTab).toHaveBeenCalledWith('chat')
  })

  it('does not steal the global active tab for a background worktree', () => {
    getState.mockReturnValue(stateWith('other'))
    frontCodevChatTab('wt', 'shell')
    expect(setActiveTabForWorktree).toHaveBeenCalledWith('wt', 'chat')
    expect(setActiveTab).not.toHaveBeenCalled()
  })

  it('is a no-op on the chat tab itself', () => {
    getState.mockReturnValue(stateWith('wt'))
    frontCodevChatTab('wt', 'chat')
    expect(setActiveTabForWorktree).not.toHaveBeenCalled()
  })
})
