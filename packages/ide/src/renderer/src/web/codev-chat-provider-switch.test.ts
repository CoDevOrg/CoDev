import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const launchAgentInNewTab = vi.fn()
const closeTab = vi.fn()
let storeState: {
  tabsByWorktree: Record<string, Array<{ id: string }>>
  closeTab: typeof closeTab
}

vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: (...args: unknown[]) => launchAgentInNewTab(...args)
}))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => storeState }
}))

import {
  codevChatProviders,
  isCodevChatProvider,
  otherCodevChatProvider,
  switchCodevChatProvider
} from './codev-chat-provider-switch'

beforeEach(() => {
  vi.useFakeTimers()
  storeState = {
    tabsByWorktree: { 'wt-1': [{ id: 'chat-old' }, { id: 'sibling' }] },
    closeTab
  }
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('codevChatProviders / isCodevChatProvider / otherCodevChatProvider', () => {
  it('offers only claude and codex when no Cursor credential is linked', () => {
    expect(codevChatProviders({})).toEqual(['claude', 'codex'])
    expect(isCodevChatProvider('claude', {})).toBe(true)
    expect(isCodevChatProvider('codex', {})).toBe(true)
    expect(isCodevChatProvider('cursor', {})).toBe(false)
    expect(isCodevChatProvider('gemini', {})).toBe(false)
    expect(isCodevChatProvider(null, {})).toBe(false)
  })

  it('adds cursor once the member has a linked Cursor credential', () => {
    const win = { __CODEV_CURSOR_AVAILABLE__: true }
    expect(codevChatProviders(win)).toEqual(['claude', 'codex', 'cursor'])
    expect(isCodevChatProvider('cursor', win)).toBe(true)
  })

  it('toggles between the two hosted providers', () => {
    expect(otherCodevChatProvider('claude')).toBe('codex')
    expect(otherCodevChatProvider('codex')).toBe('claude')
  })
})

describe('switchCodevChatProvider', () => {
  it('launches the new provider in the tab’s worktree and retires the old tab', () => {
    switchCodevChatProvider({ terminalTabId: 'chat-old', nextAgent: 'codex' })

    expect(launchAgentInNewTab).toHaveBeenCalledWith({
      agent: 'codex',
      worktreeId: 'wt-1',
      promptDelivery: 'draft',
      launchSource: 'new_workspace_composer'
    })
    expect(closeTab).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(closeTab).toHaveBeenCalledWith('chat-old', { reason: 'user' })
  })

  it('keeps the previous tab when it is the worktree’s only one (replacement not mirrored yet)', () => {
    storeState.tabsByWorktree = { 'wt-1': [{ id: 'chat-old' }] }

    switchCodevChatProvider({ terminalTabId: 'chat-old', nextAgent: 'codex' })
    vi.runAllTimers()

    expect(launchAgentInNewTab).toHaveBeenCalledTimes(1)
    expect(closeTab).not.toHaveBeenCalled()
  })

  it('does nothing when the tab cannot be located', () => {
    switchCodevChatProvider({ terminalTabId: 'missing', nextAgent: 'codex' })
    expect(launchAgentInNewTab).not.toHaveBeenCalled()
  })
})
