import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodevBridgeCommand } from './codev-bridge'

const mocks = vi.hoisted(() => ({
  runQuickCommandInNewTab: vi.fn(),
  createTab: vi.fn(() => ({ id: 'tab-1' })),
  queueTabStartupCommand: vi.fn(),
  initialAgentTabViewModeProps: vi.fn(() => ({ viewMode: 'chat' as const }))
}))

let activeWorktreeId: string | null

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      activeWorktreeId,
      settings: null,
      createTab: mocks.createTab,
      queueTabStartupCommand: mocks.queueTabStartupCommand
    })
  }
}))

vi.mock('@/lib/run-quick-command-in-new-tab', () => ({
  runQuickCommandInNewTab: mocks.runQuickCommandInNewTab
}))

vi.mock('@/lib/native-chat-initial-view-mode', () => ({
  initialAgentTabViewModeProps: mocks.initialAgentTabViewModeProps
}))

vi.mock('@/lib/native-chat-transcript-readability', () => ({
  isNativeChatTranscriptLocalReadable: () => true
}))

vi.mock('@/lib/connection-context', () => ({
  getConnectionIdFromState: () => null
}))

import { runCodevBridgeCommand } from './codev-bridge-command-handler'

describe('runCodevBridgeCommand', () => {
  beforeEach(() => {
    activeWorktreeId = 'wt-1'
    mocks.runQuickCommandInNewTab.mockReset()
    mocks.createTab.mockReset().mockReturnValue({ id: 'tab-1' })
    mocks.queueTabStartupCommand.mockReset()
    mocks.initialAgentTabViewModeProps.mockReset().mockReturnValue({ viewMode: 'chat' })
  })

  it('opens a chat-view tab tagged with the agent instead of a plain terminal', () => {
    runCodevBridgeCommand({
      kind: 'terminal-run',
      command: 'codex resume abc-123',
      label: 'Resume Codex session',
      agent: 'codex'
    })

    expect(mocks.runQuickCommandInNewTab).not.toHaveBeenCalled()
    expect(mocks.createTab).toHaveBeenCalledWith('wt-1', undefined, undefined, {
      launchAgent: 'codex',
      quickCommandLabel: 'Resume Codex session',
      viewMode: 'chat'
    })
    expect(mocks.queueTabStartupCommand).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({
        command: 'codex resume abc-123',
        launchAgent: 'codex'
      })
    )
  })

  it('falls back to a plain terminal tab for an agent native chat cannot render', () => {
    runCodevBridgeCommand({
      kind: 'terminal-run',
      command: 'some-tool resume abc-123',
      agent: 'some-unsupported-tool'
    })

    expect(mocks.createTab).not.toHaveBeenCalled()
    expect(mocks.runQuickCommandInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'wt-1' })
    )
  })

  it('opens a plain terminal tab with the exact command text, no agent composition', () => {
    runCodevBridgeCommand({
      kind: 'terminal-run',
      command: 'codex resume abc-123',
      label: 'Resume Codex session'
    })

    expect(mocks.runQuickCommandInNewTab).toHaveBeenCalledWith({
      command: {
        id: expect.any(String),
        label: 'Resume Codex session',
        action: 'terminal-command',
        command: 'codex resume abc-123',
        appendEnter: true
      },
      worktreeId: 'wt-1'
    })
  })

  it('falls back to a default label when the command has none', () => {
    runCodevBridgeCommand({ kind: 'terminal-run', command: 'codex resume abc-123' })

    expect(mocks.runQuickCommandInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ command: expect.objectContaining({ label: 'CoDev' }) })
    )
  })

  it('does nothing when no worktree is active', () => {
    activeWorktreeId = null

    runCodevBridgeCommand({ kind: 'terminal-run', command: 'codex resume abc-123' })

    expect(mocks.runQuickCommandInNewTab).not.toHaveBeenCalled()
  })

  it('ignores a command kind it does not recognize', () => {
    runCodevBridgeCommand({
      kind: 'not-a-real-kind'
    } as unknown as CodevBridgeCommand)

    expect(mocks.runQuickCommandInNewTab).not.toHaveBeenCalled()
  })
})
