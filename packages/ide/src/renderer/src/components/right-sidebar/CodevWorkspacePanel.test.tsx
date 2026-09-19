// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openModal: vi.fn(),
  setRightSidebarTab: vi.fn(),
  state: { rightSidebarTab: 'codev-branches' as string }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state & Record<string, unknown>) => unknown) =>
    selector({
      ...mocks.state,
      openModal: mocks.openModal,
      setRightSidebarTab: mocks.setRightSidebarTab
    })
}))

vi.mock('@/store/selectors', () => ({
  useActiveRepo: () => ({ id: 'repo-1' }),
  useActiveWorktree: () => ({ branch: 'refs/heads/main' })
}))

vi.mock('../sidebar/CodevReviewCheckpointPanel', () => ({
  CodevReviewCheckpointPanel: () => <div data-testid="review-checkpoint" />
}))

vi.mock('../codev/CodevBranchesOverview', () => ({
  CodevBranchesOverview: ({ onCreateBranch }: { onCreateBranch?: () => void }) => (
    <div>
      <button type="button" onClick={onCreateBranch}>
        New branch
      </button>
    </div>
  )
}))

vi.mock('./SourceControl', () => ({
  default: ({ codevWorkspaceSurface }: { codevWorkspaceSurface?: boolean }) => (
    <div data-testid="source-control">{String(codevWorkspaceSurface)}</div>
  )
}))

import { CodevWorkspacePanel } from './CodevWorkspacePanel'

describe('CodevWorkspacePanel', () => {
  beforeEach(() => {
    mocks.openModal.mockReset()
    mocks.setRightSidebarTab.mockReset()
    mocks.state.rightSidebarTab = 'codev-branches'
  })

  it('keeps branches and pull-request work in one rail surface', () => {
    render(<CodevWorkspacePanel />)

    fireEvent.click(screen.getByRole('tab', { name: 'Changes & PR' }))

    expect(mocks.setRightSidebarTab).toHaveBeenCalledWith('source-control')
    expect(screen.queryByTestId('review-checkpoint')).not.toBeNull()
    expect(screen.queryByTestId('source-control')).not.toBeNull()
  })

  it('opens the existing workspace creator from New branch', () => {
    render(<CodevWorkspacePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'New branch' }))

    expect(mocks.openModal).toHaveBeenCalledWith('new-workspace-composer', {
      initialRepoId: 'repo-1',
      initialBaseBranch: 'main',
      telemetrySource: 'unknown'
    })
  })
})
