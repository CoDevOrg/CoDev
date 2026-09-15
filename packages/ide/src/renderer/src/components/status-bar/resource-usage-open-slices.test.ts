import { describe, expect, it } from 'vitest'
import {
  getResourceUsageAllWorktrees,
  getResourceUsageRepos,
} from './resource-usage-open-slices'
import type { AppState } from '../../store'

const worktree = (): AppState['worktreesByRepo'][string][number] => ({
  id: 'wt-1',
  repoId: 'repo-1',
  path: '/repo/wt-1',
  displayName: 'wt-1',
  comment: '',
  branch: 'main',
  head: 'abc123',
  isBare: false,
  isMainWorktree: false,
  linkedIssue: null,
  linkedPR: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0
})

describe('resource usage open slices', () => {

  it('gates repo and worktree slices only while closed', () => {
    const repos = [{ id: 'repo-1', path: '/repo', kind: 'git' }] as AppState['repos']
    const row = worktree()
    const worktreesByRepo = {
      'repo-1': [row]
    }

    expect(getResourceUsageRepos({ repos }, false)).toBe(
      getResourceUsageRepos({ repos: [] }, false)
    )
    expect(getResourceUsageAllWorktrees({ worktreesByRepo }, false)).toBe(
      getResourceUsageAllWorktrees({ worktreesByRepo: {} }, false)
    )
    expect(getResourceUsageRepos({ repos }, true)).toBe(repos)
    expect(getResourceUsageAllWorktrees({ worktreesByRepo }, true)).toEqual([row])
  })
})
