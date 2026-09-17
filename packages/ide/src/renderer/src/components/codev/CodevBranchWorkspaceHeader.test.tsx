// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CODEV_OPEN_TERMINAL_DRAWER_EVENT,
  type CodevTerminalDrawerRequest
} from '../native-chat/codev-terminal-drawer-event'

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
  it('identifies the selected branch and exposes every branch-aware surface', () => {
    render(<CodevBranchWorkspaceHeader />)

    expect(
      screen.getByRole('banner', { name: 'Current branch workspace: Feature chat first' })
    ).toBeTruthy()
    expect(screen.getByText('Feature chat first')).toBeTruthy()
    expect(screen.getByText('Yousef')).toBeTruthy()
    expect(screen.getByText('1 agent')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Current branch tools' })).toBeTruthy()
  })

  it('routes branch actions to the existing store and chat drawer', () => {
    const terminalListener = vi.fn<(event: Event) => void>()
    window.addEventListener(CODEV_OPEN_TERMINAL_DRAWER_EVENT, terminalListener)
    render(<CodevBranchWorkspaceHeader />)

    fireEvent.click(screen.getByRole('button', { name: 'Explorer' }))
    expect(mocks.state.showRightSidebarFiles).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Source Control' }))
    expect(mocks.state.setRightSidebarTab).toHaveBeenCalledWith('source-control')
    expect(mocks.state.setRightSidebarOpen).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    expect(terminalListener).toHaveBeenCalledOnce()
    const terminalEvent = terminalListener.mock.calls[0]?.[0]
    expect(terminalEvent).toBeDefined()
    expect((terminalEvent as CustomEvent<CodevTerminalDrawerRequest>).detail).toEqual({
      worktreeId: 'worktree-1',
      terminalTabId: 'chat-1'
    })

    fireEvent.click(screen.getByRole('button', { name: 'Back to all branches' }))
    expect(mocks.openBranches).toHaveBeenCalledOnce()
    window.removeEventListener(CODEV_OPEN_TERMINAL_DRAWER_EVENT, terminalListener)
  })
})
