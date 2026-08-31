import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const launchAgentInNewTab = vi.fn()
const getState = vi.fn()

vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: (...args: unknown[]) => launchAgentInNewTab(...args)
}))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => getState() }
}))

import {
  CODEV_DEFAULT_CHAT_AGENT,
  codevDefaultChatAgent,
  launchCodevDefaultChatTab,
  worktreeHasAgentTab
} from './codev-default-chat-tab'

function setWindow(overrides: Record<string, unknown>): void {
  vi.stubGlobal('window', { location: { hash: '' }, ...overrides })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('codevDefaultChatAgent', () => {
  it('is null outside CoDev-embedded mode', () => {
    setWindow({ __CODEV_EMBEDDED__: false })
    expect(codevDefaultChatAgent()).toBeNull()
  })

  it('falls back to Claude when the fragment pins nothing', () => {
    setWindow({ __CODEV_EMBEDDED__: true })
    expect(codevDefaultChatAgent()).toBe(CODEV_DEFAULT_CHAT_AGENT)
  })

  it('honors a pinned Codex default', () => {
    setWindow({ __CODEV_EMBEDDED__: true, __CODEV_DEFAULT_AGENT__: 'codex' })
    expect(codevDefaultChatAgent()).toBe('codex')
  })

  it('recognizes embedding from the codev=1 fragment before the flag is set', () => {
    setWindow({ location: { hash: '#pairing=x&codev=1&codevProject=/srv/codev/workspaces/w' } })
    expect(codevDefaultChatAgent()).toBe(CODEV_DEFAULT_CHAT_AGENT)
  })
})

describe('worktreeHasAgentTab', () => {
  it('is true when a legacy tab already carries a launch agent', () => {
    getState.mockReturnValue({
      tabsByWorktree: { 'wt-1': [{ id: 't1' }, { id: 't2', launchAgent: 'claude' }] },
      unifiedTabsByWorktree: {}
    })
    expect(worktreeHasAgentTab('wt-1')).toBe(true)
  })

  it('is true when a unified tab is already in chat view', () => {
    getState.mockReturnValue({
      tabsByWorktree: { 'wt-1': [{ id: 't1' }] },
      unifiedTabsByWorktree: { 'wt-1': [{ id: 't1', viewMode: 'chat' }] }
    })
    expect(worktreeHasAgentTab('wt-1')).toBe(true)
  })

  it('is false for a worktree with only plain terminal tabs', () => {
    getState.mockReturnValue({
      tabsByWorktree: { 'wt-1': [{ id: 't1' }] },
      unifiedTabsByWorktree: { 'wt-1': [{ id: 't1', viewMode: 'terminal' }] }
    })
    expect(worktreeHasAgentTab('wt-1')).toBe(false)
  })
})

describe('launchCodevDefaultChatTab', () => {
  it('launches the default agent without a draft, so the tab opens in chat', () => {
    setWindow({ __CODEV_EMBEDDED__: true })
    getState.mockReturnValue({
      tabsByWorktree: {},
      unifiedTabsByWorktree: {},
      closeTab: vi.fn(),
      setTabViewMode: vi.fn()
    })

    launchCodevDefaultChatTab({ worktreeId: 'wt-1' })
    // The host mirrored no tabs at all: after the bounded wait, open the default.
    vi.advanceTimersByTime(10_000)

    // promptDelivery: 'draft' means "mirror this unsent text into the
    // composer"; with no text decideInitialAgentTabViewMode refuses chat and
    // the tab silently opens as a terminal. Passing nothing is what keeps it
    // in chat.
    expect(launchAgentInNewTab).toHaveBeenCalledWith({
      agent: 'claude',
      worktreeId: 'wt-1',
      launchSource: 'new_workspace_composer'
    })
  })

  it('waits for the host tab mirror before opening a default, so a restored chat wins', () => {
    setWindow({ __CODEV_EMBEDDED__: true })
    // Nothing mirrored yet at launch, then the host reports the chat the member
    // left running on their previous visit.
    getState
      .mockReturnValueOnce({ tabsByWorktree: {}, unifiedTabsByWorktree: {}, closeTab: vi.fn() })
      .mockReturnValueOnce({ tabsByWorktree: {}, unifiedTabsByWorktree: {}, closeTab: vi.fn() })
      .mockReturnValue({
        tabsByWorktree: { 'wt-1': [{ id: 't1', launchAgent: 'claude' }] },
        unifiedTabsByWorktree: {},
        closeTab: vi.fn(),
        setTabViewMode: vi.fn()
      })

    launchCodevDefaultChatTab({ worktreeId: 'wt-1' })
    vi.advanceTimersByTime(10_000)

    expect(launchAgentInNewTab).not.toHaveBeenCalled()
  })

  it('retires the stock terminal once the host has mirrored the chat tab', () => {
    setWindow({ __CODEV_EMBEDDED__: true })
    const closeTab = vi.fn()
    // The paired host mirrors its tabs late: nothing exists at launch, then the
    // shell and the chat tab appear.
    getState
      .mockReturnValueOnce({
        tabsByWorktree: {},
        unifiedTabsByWorktree: {},
        closeTab,
        setTabViewMode: vi.fn(),
      })
      .mockReturnValue({
        tabsByWorktree: {
          'wt-1': [{ id: 'shell' }, { id: 'chat', launchAgent: 'claude' }],
        },
        unifiedTabsByWorktree: {},
        closeTab,
        setTabViewMode: vi.fn(),
      })

    launchCodevDefaultChatTab({ worktreeId: 'wt-1' })
    vi.advanceTimersByTime(5_000)

    expect(closeTab).toHaveBeenCalledWith('shell', { reason: 'cleanup' })
  })

  it('never closes a shell while no agent tab exists yet', () => {
    setWindow({ __CODEV_EMBEDDED__: true })
    const closeTab = vi.fn()
    getState.mockReturnValue({
      tabsByWorktree: { 'wt-1': [{ id: 'shell' }] },
      unifiedTabsByWorktree: {},
      closeTab,
    })

    launchCodevDefaultChatTab({ worktreeId: 'wt-1' })
    vi.advanceTimersByTime(30_000)

    expect(closeTab).not.toHaveBeenCalled()
  })

  it('still sweeps a shell the host re-created next to an existing agent', () => {
    // A reload takes the already-has-an-agent path; skipping the sweep there
    // is how a second idle terminal came back on every reload.
    setWindow({ __CODEV_EMBEDDED__: true })
    const closeTab = vi.fn()
    getState.mockReturnValue({
      tabsByWorktree: {
        'wt-1': [{ id: 'chat', launchAgent: 'claude' }, { id: 'shell' }]
      },
      unifiedTabsByWorktree: {},
      closeTab,
      setTabViewMode: vi.fn()
    })

    launchCodevDefaultChatTab({ worktreeId: 'wt-1' })
    vi.advanceTimersByTime(5_000)

    expect(launchAgentInNewTab).not.toHaveBeenCalled()
    expect(closeTab).toHaveBeenCalledWith('shell', { reason: 'cleanup' })
  })

  it('does not launch a second agent when the worktree already has one', () => {
    setWindow({ __CODEV_EMBEDDED__: true })
    getState.mockReturnValue({
      tabsByWorktree: { 'wt-1': [{ id: 't1', launchAgent: 'claude' }] },
      unifiedTabsByWorktree: {},
      closeTab: vi.fn(),
      setTabViewMode: vi.fn()
    })

    launchCodevDefaultChatTab({ worktreeId: 'wt-1' })

    expect(launchAgentInNewTab).not.toHaveBeenCalled()
  })

  it('puts an existing agent tab back into chat when it reopens as a terminal', () => {
    // A workspace opened before the launch-time fix keeps viewMode 'terminal'
    // on the host and comes back a raw TUI on every reload.
    setWindow({ __CODEV_EMBEDDED__: true })
    const setTabViewMode = vi.fn()
    getState.mockReturnValue({
      tabsByWorktree: { 'wt-1': [{ id: 't1', launchAgent: 'claude' }] },
      unifiedTabsByWorktree: {
        'wt-1': [{ id: 'u1', entityId: 't1', viewMode: 'terminal' }]
      },
      closeTab: vi.fn(),
      setTabViewMode
    })

    launchCodevDefaultChatTab({ worktreeId: 'wt-1' })

    expect(setTabViewMode).toHaveBeenCalledWith('u1', 'chat')
  })

  it('leaves a tab that is already in chat alone', () => {
    setWindow({ __CODEV_EMBEDDED__: true })
    const setTabViewMode = vi.fn()
    getState.mockReturnValue({
      tabsByWorktree: { 'wt-1': [{ id: 't1', launchAgent: 'claude' }] },
      unifiedTabsByWorktree: {
        'wt-1': [{ id: 'u1', entityId: 't1', viewMode: 'chat' }]
      },
      closeTab: vi.fn(),
      setTabViewMode
    })

    launchCodevDefaultChatTab({ worktreeId: 'wt-1' })

    expect(setTabViewMode).not.toHaveBeenCalled()
  })

  it('does nothing outside CoDev-embedded mode', () => {
    setWindow({ __CODEV_EMBEDDED__: false })
    launchCodevDefaultChatTab({ worktreeId: 'wt-1' })
    expect(launchAgentInNewTab).not.toHaveBeenCalled()
  })
})
