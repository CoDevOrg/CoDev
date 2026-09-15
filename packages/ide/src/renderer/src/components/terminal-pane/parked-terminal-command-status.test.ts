import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry, AgentType } from '../../../../shared/agent-status-types'
import type { PaneForegroundAgentEntry } from '@/store/slices/pane-foreground-agent'

const PTY_ID_LOCAL = 'pty-1'
const PTY_ID_SSH = 'ssh:target-1@@pty-9'
const TAB_ID = 'tab-1'
const WORKTREE_ID = 'repo-1::/tmp/wt-1'
const PANE_KEY = `${TAB_ID}:11111111-1111-4111-8111-111111111111`
const PANE_ID = 1
// Mirrors COMMAND_CODE_OUTPUT_DONE_SETTLE_MS.

const ROUTING = { connectionId: null }

type MockStoreState = {
  tabsByWorktree: Record<string, { id: string; launchAgent?: AgentType }[]>
  agentStatusByPaneKey: Record<string, AgentStatusEntry | undefined>
  retainedAgentsByPaneKey: Record<string, { agentType: AgentType } | undefined>
  paneForegroundAgentByPaneKey: Record<string, PaneForegroundAgentEntry>
  agentLaunchConfigByPaneKey: Record<string, { identity: { agentType?: AgentType } } | undefined>
  runtimePaneTitlesByTabId: Record<string, Record<number, string | undefined>>
  setAgentStatus: ReturnType<typeof vi.fn>
  dropAgentStatus: ReturnType<typeof vi.fn>
  clearAgentLaunchConfig: ReturnType<typeof vi.fn>
}

let mockStoreState: MockStoreState
const dispatchTerminalCommandFinishedEvent = vi.fn()
const resolveLiveAgentStatusConnectionRouting = vi.fn()
const getConnectionIdFromState = vi.fn()

vi.mock('@/store', () => ({
  useAppStore: { getState: () => mockStoreState }
}))
vi.mock('@/hooks/terminal-command-finished-event', () => ({
  dispatchTerminalCommandFinishedEvent
}))
vi.mock('@/lib/agent-status-connection-ownership', () => ({
  resolveLiveAgentStatusConnectionRouting
}))
vi.mock('@/lib/connection-owner-resolution', () => ({
  getConnectionIdFromState
}))

function makeMockStoreState(): MockStoreState {
  return {
    tabsByWorktree: { [WORKTREE_ID]: [{ id: TAB_ID }] },
    agentStatusByPaneKey: {},
    retainedAgentsByPaneKey: {},
    paneForegroundAgentByPaneKey: {},
    agentLaunchConfigByPaneKey: {},
    runtimePaneTitlesByTabId: { [TAB_ID]: { [PANE_ID]: '✳ Build feature' } },
    setAgentStatus: vi.fn(),
    dropAgentStatus: vi.fn(),
    clearAgentLaunchConfig: vi.fn()
  }
}

function makeStatusEntry(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: 'build the feature',
    agentType: 'claude',
    updatedAt: 1000,
    stateStartedAt: 1000,
    ...overrides
  } as AgentStatusEntry
}

async function createPolicy(ptyId: string) {
  const { createParkedTerminalCommandStatusPolicy } =
    await import('./parked-terminal-command-status')
  return createParkedTerminalCommandStatusPolicy({
    ptyId,
    worktreeId: WORKTREE_ID,
    tabId: TAB_ID,
    paneId: PANE_ID,
    paneKey: PANE_KEY
  })
}

describe('createParkedTerminalCommandStatusPolicy', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    dispatchTerminalCommandFinishedEvent.mockClear()
    resolveLiveAgentStatusConnectionRouting.mockReset().mockReturnValue(ROUTING)
    getConnectionIdFromState.mockReset().mockReturnValue(null)
    mockStoreState = makeMockStoreState()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Why: reveal disposes the watcher mid-settle. Flushing would complete the turn early
  // and the same-prompt-done guard then drops the genuine working repaint, so the window
  // transfers to the remounted pane instead — the row stays 'working' across the boundary.

  // Why: the transferred window is still a settle window — a working repaint from the
  // revealed pane before the original deadline must cancel it, not race it.

  it('nudges git UI on command finished for every PTY class', async () => {
    const local = await createPolicy(PTY_ID_LOCAL)
    local.onCommandFinished(0)
    local.dispose()
    const ssh = await createPolicy(PTY_ID_SSH)
    ssh.onCommandFinished(0)
    ssh.dispose()

    expect(dispatchTerminalCommandFinishedEvent).toHaveBeenCalledTimes(2)
    expect(dispatchTerminalCommandFinishedEvent).toHaveBeenCalledWith(WORKTREE_ID, 0)
  })

  it('drops a same-turn status row on command finished for SSH PTYs only', async () => {
    mockStoreState.agentStatusByPaneKey[PANE_KEY] = makeStatusEntry()
    const local = await createPolicy(PTY_ID_LOCAL)
    local.onCommandFinished(0)
    // Why: local drops need the mounted pane's foreground process-confirm ladder
    // (leaked nested-shell 133;D protection), so the watcher must not drop them.
    expect(mockStoreState.dropAgentStatus).not.toHaveBeenCalled()
    local.dispose()

    const ssh = await createPolicy(PTY_ID_SSH)
    ssh.onCommandFinished(0)
    expect(mockStoreState.dropAgentStatus).toHaveBeenCalledWith(PANE_KEY)
    ssh.dispose()
  })

  it('clears the launch registry on SSH command finished when no status row exists', async () => {
    const ssh = await createPolicy(PTY_ID_SSH)

    ssh.onCommandFinished(0)

    expect(mockStoreState.clearAgentLaunchConfig).toHaveBeenCalledWith(PANE_KEY)
    expect(mockStoreState.dropAgentStatus).not.toHaveBeenCalled()
    ssh.dispose()
  })

})

describe('readInFlightCommandCodeTurn', () => {
  beforeEach(() => {
    vi.resetModules()
    mockStoreState = makeMockStoreState()
  })

})
