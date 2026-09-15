import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createGitHubPullRequestMock,
  getRepoSlugMock,
  getHostedReviewForBranchMock,
  ghExecFileAsyncMock,
  gitExecFileAsyncMock,
  getUpstreamStatusMock,
  getSshGitProviderMock,
  getEnterpriseGitHubRepoSlugMock
} = vi.hoisted(() => ({
  createGitHubPullRequestMock: vi.fn(),
  getRepoSlugMock: vi.fn(),
  getHostedReviewForBranchMock: vi.fn(),
  ghExecFileAsyncMock: vi.fn(),
  gitExecFileAsyncMock: vi.fn(),
  getUpstreamStatusMock: vi.fn(),
  getSshGitProviderMock: vi.fn(),
  getEnterpriseGitHubRepoSlugMock: vi.fn()
}))

vi.mock('../github/client', () => ({
  createGitHubPullRequest: createGitHubPullRequestMock,
  getRepoSlug: getRepoSlugMock,
  getPRForBranch: vi.fn()
}))

vi.mock('../github/github-enterprise-repository', () => ({
  getEnterpriseGitHubRepoSlug: getEnterpriseGitHubRepoSlugMock
}))

vi.mock('../github/gh-utils', () => ({
  acquire: vi.fn(),
  release: vi.fn(),
  ghExecFileAsync: ghExecFileAsyncMock,
  gitExecFileAsync: gitExecFileAsyncMock
}))

vi.mock('../git/upstream', () => ({
  getUpstreamStatus: getUpstreamStatusMock
}))

vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: getSshGitProviderMock
}))

vi.mock('./hosted-review', () => ({
  getHostedReviewForBranch: getHostedReviewForBranchMock
}))

import { createHostedReview, getHostedReviewCreationEligibility } from './hosted-review-creation'

import { _resetOriginGitHubApiRepositoryCache } from '../github/github-api-repository'

// The origin-repository cache is module-level state; reset it so slugs
// resolved by one test cannot leak into the next.
beforeEach(() => {
  _resetOriginGitHubApiRepositoryCache()
})

function resetMocks(): void {
  for (const mock of [
    createGitHubPullRequestMock,
    getRepoSlugMock,
    getHostedReviewForBranchMock,
    ghExecFileAsyncMock,
    gitExecFileAsyncMock,
    getUpstreamStatusMock,
    getSshGitProviderMock,
    getEnterpriseGitHubRepoSlugMock
  ]) {
    mock.mockReset()
  }
}

function mockGitHubProvider(): void {
  getRepoSlugMock.mockResolvedValue({ owner: 'acme', repo: 'orca' })
  getEnterpriseGitHubRepoSlugMock.mockResolvedValue(null)
}

// GHES: github.com-only slug parsing misses the custom host, so the enterprise
// resolver claims the repo and reports the host for the gh auth probe (#8312).
function mockGitHubEnterpriseProvider(): void {
  // Why: getRepoSlug resolves hosted identities itself now — a GHES remote
  // comes back host-qualified instead of null + separate enterprise fallback.
  getRepoSlugMock.mockResolvedValue({
    owner: 'acme',
    repo: 'orca',
    host: 'github.acme-corp.com'
  })
  // The auth gate still keys off the enterprise resolver (authed-GHES signal).
  getEnterpriseGitHubRepoSlugMock.mockResolvedValue({
    owner: 'acme',
    repo: 'orca',
    host: 'github.acme-corp.com'
  })
}

describe('getHostedReviewCreationEligibility', () => {
  beforeEach(() => {
    resetMocks()

    mockGitHubProvider()
    getHostedReviewForBranchMock.mockResolvedValue(null)
    ghExecFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })
    gitExecFileAsyncMock.mockResolvedValue({ stdout: 'Feature title\n', stderr: '' })
  })

  it('treats short remote base refs as the default branch name', async () => {
    await expect(
      getHostedReviewCreationEligibility({
        repoPath: '/repo',
        branch: 'main',
        base: 'origin/main',
        hasUncommittedChanges: false,
        hasUpstream: true,
        ahead: 0,
        behind: 0
      })
    ).resolves.toMatchObject({
      canCreate: false,
      blockedReason: 'default_branch',
      defaultBaseRef: 'origin/main'
    })
  })

  it('reports reviewLookupOutcome: found when an existing review is returned', async () => {
    getHostedReviewForBranchMock.mockResolvedValue({ number: 7, url: 'https://x/pull/7' })
    await expect(
      getHostedReviewCreationEligibility({
        repoPath: '/repo',
        branch: 'feature/x',
        hasUncommittedChanges: false,
        hasUpstream: true,
        ahead: 0,
        behind: 0
      })
    ).resolves.toMatchObject({ blockedReason: 'existing_review', reviewLookupOutcome: 'found' })
  })

  it('reports reviewLookupOutcome: not_found when the lookup accepts no review', async () => {
    getHostedReviewForBranchMock.mockResolvedValue(null)
    await expect(
      getHostedReviewCreationEligibility({
        repoPath: '/repo',
        branch: 'feature/x',
        hasUncommittedChanges: false,
        hasUpstream: true,
        ahead: 0,
        behind: 0
      })
    ).resolves.toMatchObject({ reviewLookupOutcome: 'not_found' })
  })

  it('reports reviewLookupOutcome: unavailable when a swallowed lookup failure yields a local blocker', async () => {
    getHostedReviewForBranchMock.mockRejectedValue(new Error('ssh: connection refused'))
    await expect(
      getHostedReviewCreationEligibility({
        repoPath: '/repo',
        branch: 'feature/x',
        hasUncommittedChanges: false,
        hasUpstream: false,
        ahead: 0,
        behind: 0
      })
    ).resolves.toMatchObject({ blockedReason: 'no_upstream', reviewLookupOutcome: 'unavailable' })
  })

  it('never marks a clean, in-sync branch creatable when the review lookup fails', async () => {
    // A failed existing-review lookup leaves review existence unproven, so the
    // happy path must not claim canCreate — that would offer Create against a
    // branch that might already have a review (finding 4).
    getHostedReviewForBranchMock.mockRejectedValue(new Error('gh: could not connect to github.com'))
    await expect(
      getHostedReviewCreationEligibility({
        repoPath: '/repo',
        branch: 'feature/x',
        base: 'origin/main',
        hasUncommittedChanges: false,
        hasUpstream: true,
        ahead: 0,
        behind: 0
      })
    ).resolves.toMatchObject({
      canCreate: false,
      blockedReason: null,
      reviewLookupOutcome: 'unavailable'
    })
  })

  it('refuses to create when the existing-review lookup is unavailable (finding 5)', async () => {
    getHostedReviewForBranchMock.mockRejectedValue(new Error('gh: connection refused'))
    getUpstreamStatusMock.mockResolvedValue({ hasUpstream: true, ahead: 0, behind: 0 })
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') {
        return { stdout: 'feature/x\n', stderr: '' }
      }
      if (args[0] === 'status') {
        return { stdout: '', stderr: '' }
      }
      // symbolic-ref / for-each-ref resolve the base on the remote.
      return { stdout: 'refs/remotes/origin/main\n', stderr: '' }
    })

    const result = await createHostedReview('/repo', {
      provider: 'github',
      base: 'main',
      head: 'feature/x',
      title: 'Add feature'
    })

    expect(result).toMatchObject({ ok: false, code: 'validation' })
    // The provider create API must never run on an inconclusive lookup.
    expect(createGitHubPullRequestMock).not.toHaveBeenCalled()
  })

  // Stacked-worktree base resolution (Change 1/2). `stackedArgs` defaults to a
  // bare local-only parent; `mockRefs` controls the remote-tracking snapshot.
  const stackedArgs = (
    overrides: Partial<Parameters<typeof getHostedReviewCreationEligibility>[0]> = {}
  ): Parameters<typeof getHostedReviewCreationEligibility>[0] => ({
    repoPath: '/repo',
    branch: 'feature/stacked',
    base: 'stacked-parent',
    hasUncommittedChanges: false,
    hasUpstream: true,
    ahead: 0,
    behind: 0,
    ...overrides
  })

  const mockRefs = (opts: {
    symbolicRef?: string
    forEachRef?: string
    forEachThrows?: boolean
    revParseThrows?: boolean
  }): void => {
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'symbolic-ref') {
        return { stdout: opts.symbolicRef ?? '', stderr: '' }
      }
      if (args[0] === 'for-each-ref') {
        if (opts.forEachThrows) {
          throw new Error('ssh: connect: connection refused')
        }
        return { stdout: opts.forEachRef ?? '', stderr: '' }
      }
      if (args[0] === 'rev-parse' && opts.revParseThrows) {
        throw new Error('unknown revision')
      }
      return { stdout: 'refs/remotes/origin/main\n', stderr: '' }
    })
  }

  it('falls back to the repo default when a stacked parent base is local-only', async () => {
    mockRefs({ symbolicRef: 'refs/remotes/origin/main\n' })
    await expect(getHostedReviewCreationEligibility(stackedArgs())).resolves.toMatchObject({
      canCreate: true,
      blockedReason: null,
      defaultBaseRef: 'origin/main'
    })
  })

  it('preserves a stacked parent base that exists on the remote', async () => {
    mockRefs({ forEachRef: 'refs/remotes/origin/parent-pushed\n' })
    await expect(
      getHostedReviewCreationEligibility(stackedArgs({ base: 'parent-pushed' }))
    ).resolves.toMatchObject({
      canCreate: true,
      blockedReason: null,
      defaultBaseRef: 'parent-pushed'
    })
  })

  it('keeps the candidate base when no repo default can be resolved', async () => {
    mockRefs({ revParseThrows: true })
    await expect(getHostedReviewCreationEligibility(stackedArgs())).resolves.toMatchObject({
      canCreate: true,
      blockedReason: null,
      defaultBaseRef: 'stacked-parent'
    })
  })

  it('preserves the candidate base when the remote probe cannot reach the host', async () => {
    // Transport failure must not be read as "absent" — that would demote a
    // legitimately-pushed parent to the repo default on a transient SSH blip.
    mockRefs({ forEachThrows: true })
    await expect(
      getHostedReviewCreationEligibility(stackedArgs({ base: 'parent-pushed' }))
    ).resolves.toMatchObject({ canCreate: true, defaultBaseRef: 'parent-pushed' })
  })

  it('blocks dirty tracked GitHub branches before PR creation', async () => {
    await expect(
      getHostedReviewCreationEligibility({
        repoPath: '/repo',
        branch: 'feature/create-pr',
        base: 'main',
        hasUncommittedChanges: true,
        hasUpstream: true,
        ahead: 0,
        behind: 0
      })
    ).resolves.toMatchObject({
      provider: 'github',
      canCreate: false,
      blockedReason: 'dirty',
      nextAction: 'commit',
      head: 'feature/create-pr'
    })
  })

  it('keeps dirty feature branches eligible for PR preparation when review lookup fails', async () => {
    getHostedReviewForBranchMock.mockRejectedValueOnce(new Error('gh lookup failed'))

    await expect(
      getHostedReviewCreationEligibility({
        repoPath: '/repo',
        branch: 'feature/create-pr',
        base: 'main',
        hasUncommittedChanges: true,
        hasUpstream: false,
        ahead: 0,
        behind: 0
      })
    ).resolves.toMatchObject({
      provider: 'github',
      canCreate: false,
      blockedReason: 'dirty',
      nextAction: 'commit',
      head: 'feature/create-pr'
    })
  })

  it('enables creation for clean, in-sync, authenticated GitHub feature branches', async () => {
    await expect(
      getHostedReviewCreationEligibility({
        repoPath: '/repo',
        branch: 'refs/heads/feature/create-pr',
        base: 'origin/main',
        hasUncommittedChanges: false,
        hasUpstream: true,
        ahead: 0,
        behind: 0
      })
    ).resolves.toMatchObject({
      provider: 'github',
      canCreate: true,
      blockedReason: null,
      nextAction: null,
      defaultBaseRef: 'origin/main',
      head: 'feature/create-pr'
    })
  })

  it('detects a GitHub Enterprise Server branch as the GitHub provider (#8312)', async () => {
    mockGitHubEnterpriseProvider()

    await expect(
      getHostedReviewCreationEligibility({
        repoPath: '/repo',
        branch: 'feature/create-pr',
        base: 'origin/main',
        hasUncommittedChanges: false,
        hasUpstream: true,
        ahead: 0,
        behind: 0
      })
    ).resolves.toMatchObject({
      provider: 'github',
      canCreate: true,
      blockedReason: null,
      nextAction: null
    })

    // Enterprise auth was already confirmed during detection; the gate must not
    // fire a redundant gh probe.
    expect(ghExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('offers push as the next action for authenticated branches with local-only commits', async () => {
    await expect(
      getHostedReviewCreationEligibility({
        repoPath: '/repo',
        branch: 'feature/create-pr',
        base: 'main',
        hasUncommittedChanges: false,
        hasUpstream: true,
        ahead: 2,
        behind: 0
      })
    ).resolves.toMatchObject({
      canCreate: false,
      blockedReason: 'needs_push',
      nextAction: 'push'
    })
  })

})
