import { describe, expect, it } from 'vitest'
import type { } from '../../../../shared/hosted-review'
import type { PRInfo, Repo, Worktree } from '../../../../shared/types'
import { getGitHubPRCacheKey } from '@/store/slices/github-cache-key'
import { } from '@/store/slices/hosted-review-cache-identity'
import { getRepoHostIdentity } from '@/store/slices/repo-host-identity'
import { buildWorktreeChecksReviewIndex } from './worktree-checks-review-index'

const repo: Repo = {
  id: 'repo-1',
  path: '/remote/orca',
  displayName: 'orca',
  badgeColor: '#000000',
  addedAt: 0,
  executionHostId: 'ssh:staging'
}

const worktree: Worktree = {
  id: 'worktree-1',
  repoId: repo.id,
  path: '/remote/orca-worktrees/search',
  head: 'abc123',
  branch: 'refs/heads/feature/search',
  isBare: false,
  isMainWorktree: false,
  displayName: 'Search reviews',
  comment: '',
  linkedIssue: null,
  linkedPR: 42,
  hostId: 'ssh:staging',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0
}

function makePR(): PRInfo {
  return {
    number: 42,
    title: 'Search worktrees by their pull requests',
    state: 'open',
    url: 'https://github.com/acme/orca/pull/42',
    checksStatus: 'success',
    updatedAt: '2026-07-12T00:00:00Z',
    mergeable: 'MERGEABLE'
  }
}

describe('buildWorktreeChecksReviewIndex', () => {
  it('reads the same host-scoped GitHub PR cache entry as Checks', () => {
    const key = getGitHubPRCacheKey(
      repo.path,
      repo.id,
      'feature/search',
      null,
      repo.connectionId,
      repo.executionHostId,
      true
    )

    const reviews = buildWorktreeChecksReviewIndex({
      worktrees: [worktree],
      repoByHostIdentity: new Map([[getRepoHostIdentity(repo), repo]]),
      prCache: { [key]: { data: makePR(), fetchedAt: 1 } },
      hostedReviewCache: {},
      settings: null
    })

    expect(reviews.get(worktree)).toMatchObject({
      provider: 'github',
      number: 42,
      title: 'Search worktrees by their pull requests'
    })
  })

  it('keeps same-id worktrees isolated across execution hosts', () => {
    const localRepo: Repo = {
      ...repo,
      path: '/local/orca',
      executionHostId: 'local'
    }
    const localWorktree: Worktree = { ...worktree, hostId: 'local' }
    const sshWorktree: Worktree = { ...worktree, hostId: 'ssh:staging' }
    const sshKey = getGitHubPRCacheKey(
      repo.path,
      repo.id,
      'feature/search',
      null,
      repo.connectionId,
      repo.executionHostId,
      true
    )

    const reviews = buildWorktreeChecksReviewIndex({
      worktrees: [localWorktree, sshWorktree],
      repoByHostIdentity: new Map([
        [getRepoHostIdentity(localRepo), localRepo],
        [getRepoHostIdentity(repo), repo]
      ]),
      prCache: { [sshKey]: { data: makePR(), fetchedAt: 1 } },
      hostedReviewCache: {},
      settings: null
    })

    expect(reviews.has(localWorktree)).toBe(false)
    expect(reviews.get(sshWorktree)).toMatchObject({ provider: 'github', number: 42 })
  })

  it('skips a branch-less worktree instead of throwing', () => {
    // Why: Cmd+J builds this index for every worktree before any query is typed,
    // so a folder workspace (empty branch) or a partially hydrated row reaches it.
    const branchless: Worktree = {
      ...worktree,
      id: 'worktree-folder',
      branch: undefined as unknown as string,
      displayName: undefined as unknown as string
    }

    const reviews = buildWorktreeChecksReviewIndex({
      worktrees: [branchless],
      repoByHostIdentity: new Map([[getRepoHostIdentity(repo), repo]]),
      prCache: {},
      hostedReviewCache: {},
      settings: null
    })

    expect(reviews.has(branchless)).toBe(false)
  })
})
