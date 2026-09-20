import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activateAndRevealWorktree: vi.fn(),
  getState: vi.fn(),
  isCodevEmbedded: vi.fn(),
  openCodevManagedAgentWorktree: vi.fn(),
  requestCodevBridge: vi.fn(),
  setRightSidebarOpen: vi.fn(),
  setRightSidebarTab: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: mocks.activateAndRevealWorktree
}))
vi.mock('@/store', () => ({
  useAppStore: { getState: mocks.getState }
}))
vi.mock('./codev-embedded', () => ({
  isCodevEmbedded: mocks.isCodevEmbedded
}))
vi.mock('./codev-bridge-singleton', () => ({
  requestCodevBridge: mocks.requestCodevBridge
}))
vi.mock('./codev-proposal-discard', () => ({
  openCodevManagedAgentWorktree: mocks.openCodevManagedAgentWorktree
}))

import { startCodevManagedAgent } from './codev-managed-agent'

describe('startCodevManagedAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isCodevEmbedded.mockReturnValue(true)
    mocks.requestCodevBridge.mockResolvedValue({
      created: { sessionId: 'session-1', worktreeId: 'worktree-1' },
      rejection: null
    })
    mocks.getState.mockReturnValue({
      activeWorktreeId: 'source-worktree',
      worktreesByRepo: { 'repo-1': [{ id: 'source-worktree' }] },
      createWorktree: vi.fn(),
      updateWorktreeMeta: vi.fn(),
      setRightSidebarOpen: mocks.setRightSidebarOpen,
      setRightSidebarTab: mocks.setRightSidebarTab
    })
  })

  it('releases the server reservation when Orca setup fails', async () => {
    const error = new Error('comment update failed')
    mocks.openCodevManagedAgentWorktree.mockRejectedValue(error)
    mocks.requestCodevBridge
      .mockResolvedValueOnce({
        created: { sessionId: 'session-1', worktreeId: 'worktree-1' },
        rejection: null
      })
      .mockResolvedValueOnce({ status: 'stopped' })

    await expect(startCodevManagedAgent()).rejects.toBe(error)
    expect(mocks.requestCodevBridge).toHaveBeenNthCalledWith(2, 'agents.discard', {
      sessionId: 'session-1'
    })
  })
})
