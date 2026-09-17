// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../../shared/types'
import type { CodevBranchSummary } from './codev-branches-model'
import { CodevBranchCard } from './CodevBranchCard'

const worktree = (overrides: Partial<Worktree> = {}): Worktree =>
  ({
    id: 'worktree-1',
    repoId: 'repo-1',
    path: '/srv/codev/feature-chat-first',
    branch: 'feature/chat-first',
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    displayName: 'Feature chat first',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 100,
    ...overrides
  }) as Worktree

const branch = (overrides: Partial<CodevBranchSummary> = {}): CodevBranchSummary => ({
  id: 'worktree-1',
  worktree: worktree(),
  slot: null,
  label: 'feature/chat-first',
  gitBranch: 'feature/chat-first',
  owner: 'Yousef',
  agentCount: 2,
  provider: 'Claude',
  agentStatus: 'Working',
  providerReady: true,
  providerIssue: null,
  statusDetail: null,
  changedFiles: 3,
  lastActivityAt: 100,
  state: 'active',
  ...overrides
})

afterEach(cleanup)

describe('CodevBranchCard', () => {
  it('exposes the branch context needed to enter the shared workspace', () => {
    const onOpen = vi.fn()
    render(<CodevBranchCard row={branch()} active opening={false} now={100} onOpen={onOpen} />)

    const card = screen.getByRole('button', { name: /feature\/chat-first.*Open branch/i })
    expect(card.getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('Yousef')).toBeTruthy()
    expect(screen.getByText('2 agents')).toBeTruthy()
    expect(screen.getByText('Claude')).toBeTruthy()
    expect(screen.getByText('3 files')).toBeTruthy()
    expect(card.textContent).toContain('Working')

    fireEvent.click(card)
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('disables entry while a branch is provisioning and explains why', () => {
    render(
      <CodevBranchCard
        row={branch({
          worktree: null,
          label: 'Checkout settings',
          gitBranch: '',
          agentCount: 0,
          provider: null,
          agentStatus: 'Preparing',
          providerReady: null,
          state: 'provisioning',
          statusDetail: 'The shared worktree is being prepared.'
        })}
        active={false}
        opening={false}
        now={100}
        onOpen={vi.fn()}
      />
    )

    const card = screen.getByRole('button', { name: /Checkout settings.*Preparing branch/i })
    expect((card as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Preparing branch…')).toBeTruthy()
    expect(screen.getByText('The shared worktree is being prepared.')).toBeTruthy()
  })

  it('keeps the branch visible when its provider is unavailable and gives recovery context', () => {
    render(
      <CodevBranchCard
        row={branch({
          providerReady: false,
          providerIssue: 'Claude connection revoked. Reconnect it before sending work.',
          state: 'failed',
          statusDetail: 'The branch can still be inspected.'
        })}
        active={false}
        opening={false}
        now={100}
        onOpen={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /feature\/chat-first.*Open branch/i })).toBeTruthy()
    expect(screen.getByText('Claude · unavailable')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain(
      'Claude connection revoked. Reconnect it before sending work.'
    )
  })
})
