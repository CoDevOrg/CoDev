import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodevBridgeCommand } from './codev-bridge'

const mocks = vi.hoisted(() => ({
  runQuickCommandInNewTab: vi.fn()
}))

let activeWorktreeId: string | null

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ activeWorktreeId })
  }
}))

vi.mock('@/lib/run-quick-command-in-new-tab', () => ({
  runQuickCommandInNewTab: mocks.runQuickCommandInNewTab
}))

import { runCodevBridgeCommand } from './codev-bridge-command-handler'

describe('runCodevBridgeCommand', () => {
  beforeEach(() => {
    activeWorktreeId = 'wt-1'
    mocks.runQuickCommandInNewTab.mockReset()
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
