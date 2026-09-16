// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  embedded: true,
  chatTabId: null as string | null,
  launchAgentInNewTab: vi.fn(),
  markLaunching: vi.fn(),
  clearLaunching: vi.fn(),
  setActiveTabForWorktree: vi.fn(),
  setActiveTab: vi.fn()
}))

vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: mocks.launchAgentInNewTab
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      activeWorktreeId: 'wt-1',
      tabsByWorktree: { 'wt-1': [] },
      unifiedTabsByWorktree: {},
      setActiveTabForWorktree: mocks.setActiveTabForWorktree,
      setActiveTab: mocks.setActiveTab
    })
  }
}))
vi.mock('./codev-embedded', () => ({
  isCodevEmbedded: () => mocks.embedded
}))
vi.mock('./codev-center-chat-tab', () => ({
  codevChatTabIdInState: () => mocks.chatTabId
}))
vi.mock('./codev-agent-launch-state', () => ({
  markCodevAgentLaunching: mocks.markLaunching,
  clearCodevAgentLaunching: mocks.clearLaunching
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: () => null
}))
vi.mock('@/runtime/web-runtime-session', () => ({
  isWebRuntimeSessionActive: () => false
}))
vi.mock('@/runtime/web-session-tabs-sync', () => ({
  getLastKnownHostTerminalTabCount: () => 0
}))

import { codevDefaultChatAgent, ensureCodevDefaultChat } from './codev-default-chat'

beforeEach(() => {
  mocks.embedded = true
  mocks.chatTabId = null
  mocks.launchAgentInNewTab.mockReset()
  mocks.markLaunching.mockReset()
  mocks.clearLaunching.mockReset()
  mocks.setActiveTabForWorktree.mockReset()
  mocks.setActiveTab.mockReset()
  delete window.__CODEV_DEFAULT_AGENT__
})

describe('codevDefaultChatAgent', () => {
  it('uses the paired provider and falls back to Claude', () => {
    expect(codevDefaultChatAgent()).toBe('claude')
    window.__CODEV_DEFAULT_AGENT__ = 'codex'
    expect(codevDefaultChatAgent()).toBe('codex')
  })
})

describe('ensureCodevDefaultChat', () => {
  it('fronts an existing chat without launching another agent', async () => {
    mocks.chatTabId = 'chat-1'

    await expect(ensureCodevDefaultChat('wt-1')).resolves.toBe(true)

    expect(mocks.launchAgentInNewTab).not.toHaveBeenCalled()
    expect(mocks.setActiveTabForWorktree).toHaveBeenCalledWith('wt-1', 'chat-1')
    expect(mocks.setActiveTab).toHaveBeenCalledWith('chat-1')
  })

  it('launches the default chat exactly once when the workspace has only a shell', async () => {
    mocks.launchAgentInNewTab.mockImplementation(() => {
      mocks.chatTabId = 'chat-2'
      return { tabId: null }
    })

    await expect(ensureCodevDefaultChat('wt-1')).resolves.toBe(true)

    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith({
      agent: 'claude',
      worktreeId: 'wt-1',
      launchSource: 'new_workspace_composer'
    })
    expect(mocks.markLaunching).toHaveBeenCalledWith('wt-1')
    expect(mocks.clearLaunching).toHaveBeenCalledWith('wt-1')
  })
})
