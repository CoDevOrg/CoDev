// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = {
    activeWorktreeId: 'worktree-1',
    tabsByWorktree: { 'worktree-1': [{ id: 'chat-1', launchAgent: 'claude' }] },
    unifiedTabsByWorktree: {},
    setRightSidebarTab: vi.fn(),
    setRightSidebarOpen: vi.fn(),
    showRightSidebarFiles: vi.fn()
  }
  return {
    state,
    activeWorktree: {
      id: 'worktree-1',
      repoId: 'repo-1',
      path: '/workspace/feature-chat-first',
      branch: 'feature/chat-first',
      displayName: 'Feature chat first',
      isMainWorktree: false
    },
    row: {
      id: 'worktree-1',
      worktree: null,
      slot: null,
      label: 'Feature chat first',
      gitBranch: 'feature/chat-first',
      owner: 'Yousef',
      agentCount: 1,
      provider: 'Claude',
      agentStatus: 'working',
      changedFiles: 2,
      lastActivityAt: 10,
      state: 'active' as const
    },
    openBranches: vi.fn()
  }
})

vi.mock('@/store', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
  return { useAppStore }
})

vi.mock('@/store/selectors', () => ({
  useActiveWorktree: () => mocks.activeWorktree
}))

vi.mock('@/web/codev-embedded', () => ({
  isCodevEmbedded: () => true
}))

vi.mock('./codev-branches-view', () => ({
  openCodevBranches: mocks.openBranches,
  useCodevBranchesOpen: () => false
}))

vi.mock('./use-codev-branch-rows', () => ({
  useCodevBranchRows: () => ({ rows: [mocks.row] })
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

import { CodevBranchWorkspaceHeader } from './CodevBranchWorkspaceHeader'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CodevBranchWorkspaceHeader', () => {
  it('identifies the selected branch and keeps the header focused on branch context', () => {
    render(<CodevBranchWorkspaceHeader />)

    expect(
      screen.getByRole('banner', { name: 'Current branch workspace: Feature chat first' })
    ).toBeTruthy()
    expect(screen.getByText('Feature chat first')).toBeTruthy()
    expect(screen.getByText('Yousef')).toBeTruthy()
    expect(screen.getByText('1 agent')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Current branch tools' })).toBeNull()
  })

  it('keeps branch navigation in the workspace header', () => {
    render(<CodevBranchWorkspaceHeader />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to all branches' }))
    expect(mocks.openBranches).toHaveBeenCalledOnce()
    expect(screen.queryByRole('navigation', { name: 'Current branch tools' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Explorer' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Terminal' })).toBeNull()
  })
})
