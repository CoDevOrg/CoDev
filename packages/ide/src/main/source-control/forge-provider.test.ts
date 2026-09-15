import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createGitHubPullRequestMock,
  getPRForBranchOutcomeMock,
  getRepoSlugMock,
  getGitHubPRLookupRateLimitBlockMock,
  getEnterpriseGitHubRepoSlugMock
} = vi.hoisted(() => ({
  createGitHubPullRequestMock: vi.fn(),
  getPRForBranchOutcomeMock: vi.fn(),
  getRepoSlugMock: vi.fn(),
  getGitHubPRLookupRateLimitBlockMock: vi.fn(async () => null),
  getEnterpriseGitHubRepoSlugMock: vi.fn()
}))

vi.mock('../github/client', () => ({
  createGitHubPullRequest: createGitHubPullRequestMock,
  getRepoSlug: getRepoSlugMock,
  getPRForBranchOutcome: getPRForBranchOutcomeMock,
  getGitHubPRLookupRateLimitBlock: getGitHubPRLookupRateLimitBlockMock
}))

vi.mock('../github/github-enterprise-repository', () => ({
  getEnterpriseGitHubRepoSlug: getEnterpriseGitHubRepoSlugMock
}))

import {
  FORGE_PROVIDERS,
  detectHostedReviewProvider,
  getForgeProviderById,
  getForgeProviderForRepository
} from './forge-provider'

import { _resetOriginGitHubApiRepositoryCache } from '../github/github-api-repository'

// The origin-repository cache is module-level state; reset it so slugs
// resolved by one test cannot leak into the next.
beforeEach(() => {
  _resetOriginGitHubApiRepositoryCache()
})

describe('forge provider interface', () => {
  beforeEach(() => {
    createGitHubPullRequestMock.mockReset()
    getPRForBranchOutcomeMock.mockReset()
    getRepoSlugMock.mockReset()
    getEnterpriseGitHubRepoSlugMock.mockReset()
    getGitHubPRLookupRateLimitBlockMock.mockReset()
    getGitHubPRLookupRateLimitBlockMock.mockResolvedValue(null)
  })

  it('detects a GitHub remote as the GitHub provider', async () => {
    getRepoSlugMock.mockResolvedValue({ owner: 'team', repo: 'orca' })

    await expect(detectHostedReviewProvider({ repoPath: '/repo' })).resolves.toBe('github')
    await expect(getForgeProviderForRepository({ repoPath: '/repo' })).resolves.toMatchObject({
      id: 'github'
    })
  })

  it('reports an unsupported provider when no remote is claimed', async () => {
    getRepoSlugMock.mockResolvedValue(null)

    await expect(detectHostedReviewProvider({ repoPath: '/repo' })).resolves.toBe('unsupported')
    await expect(getForgeProviderForRepository({ repoPath: '/repo' })).resolves.toBeNull()
  })

  it('detects a GitHub Enterprise Server remote as the GitHub provider', async () => {
    // Regression for #8312: a GHES host is not github.com, so github.com-only
    // slug parsing returns null. Detection must claim it via the enterprise
    // resolver.
    // Why: getRepoSlug resolves hosted identities itself now — a GHES remote
    // comes back host-qualified instead of null + separate enterprise fallback.
    getRepoSlugMock.mockResolvedValue({
      owner: 'team',
      repo: 'orca',
      host: 'github.acme-corp.com'
    })

    await expect(detectHostedReviewProvider({ repoPath: '/repo' })).resolves.toBe('github')
    await expect(getForgeProviderForRepository({ repoPath: '/repo' })).resolves.toMatchObject({
      id: 'github'
    })
  })

  it('keeps review creation capability scoped to providers with creation support', async () => {
    expect(
      FORGE_PROVIDERS.map((provider) => [provider.id, provider.supportsReviewCreation])
    ).toEqual([['github', true]])
    createGitHubPullRequestMock.mockResolvedValue({
      ok: true,
      number: 12,
      url: 'https://github.com/team/orca/pull/12'
    })

    const provider = getForgeProviderById('github')
    await expect(
      provider.createReview?.('/repo', {
        provider: 'github',
        base: 'main',
        head: 'feature/provider-interface',
        title: 'Add provider interface'
      })
    ).resolves.toEqual({
      ok: true,
      number: 12,
      url: 'https://github.com/team/orca/pull/12'
    })
    expect(createGitHubPullRequestMock).toHaveBeenCalledWith('/repo', {
      provider: 'github',
      base: 'main',
      head: 'feature/provider-interface',
      title: 'Add provider interface'
    })
  })

  it('adapts GitHub branch lookup through the shared provider contract', async () => {
    getPRForBranchOutcomeMock.mockResolvedValue({
      kind: 'found',
      fetchedAt: 1,
      pr: {
        number: 7,
        title: 'Provider branch',
        state: 'open',
        url: 'https://github.com/team/orca/pull/7',
        checksStatus: 'success',
        updatedAt: '2026-05-29T00:00:00.000Z',
        mergeable: 'MERGEABLE'
      }
    })

    await expect(
      getForgeProviderById('github').getReviewForBranch({
        repoPath: '/repo',
        connectionId: 'ssh-1',
        branch: '',
        fallbackReviewNumber: 7
      })
    ).resolves.toMatchObject({
      provider: 'github',
      number: 7,
      status: 'success'
    })
    expect(getPRForBranchOutcomeMock).toHaveBeenCalledWith('/repo', '', null, 'ssh-1', 7, {
      acceptMergedFallbackPR: true,
      currentHeadOid: null
    })
  })

  it('passes the worktree HEAD oid through to the GitHub lookup', async () => {
    getPRForBranchOutcomeMock.mockResolvedValue({ kind: 'no-pr', fetchedAt: 1 })

    await getForgeProviderById('github').getReviewForBranch({
      repoPath: '/repo',
      connectionId: null,
      branch: 'feature/x',
      githubCurrentHeadOid: 'abc1234'
    })

    expect(getPRForBranchOutcomeMock).toHaveBeenCalledWith('/repo', 'feature/x', null, null, null, {
      currentHeadOid: 'abc1234'
    })
  })

  it('returns null for a confirmed GitHub no-pr lookup', async () => {
    getPRForBranchOutcomeMock.mockResolvedValue({ kind: 'no-pr', fetchedAt: 1 })

    await expect(
      getForgeProviderById('github').getReviewForBranch({
        repoPath: '/repo',
        connectionId: null,
        branch: 'feature/x'
      })
    ).resolves.toBeNull()
  })

  it('throws on a GitHub upstream error instead of reporting no review', async () => {
    getPRForBranchOutcomeMock.mockResolvedValue({
      kind: 'upstream-error',
      errorType: 'network',
      message: 'connection reset',
      fetchedAt: 1
    })

    await expect(
      getForgeProviderById('github').getReviewForBranch({
        repoPath: '/repo',
        connectionId: null,
        branch: 'feature/x'
      })
    ).rejects.toThrow(/network/)
  })

  it('refuses a GitHub branch lookup while the rate-limit budget is exhausted (#11532)', async () => {
    getGitHubPRLookupRateLimitBlockMock.mockResolvedValueOnce({
      resetAt: 1_800_000_000
    } as never)

    await expect(
      getForgeProviderById('github').getReviewForBranch({
        repoPath: '/repo',
        connectionId: null,
        branch: 'feature/x'
      })
      // Throwing (not null) keeps a low budget from reading as "no pull request".
    ).rejects.toThrow(/rate_limited/)
    expect(getPRForBranchOutcomeMock).not.toHaveBeenCalled()
  })

  it('refuses a GitHub lookup by number while the rate-limit budget is exhausted (#11532)', async () => {
    getGitHubPRLookupRateLimitBlockMock.mockResolvedValueOnce({
      resetAt: 1_800_000_000
    } as never)

    await expect(
      getForgeProviderById('github').getReviewByNumber({
        repoPath: '/repo',
        connectionId: null,
        number: 42
      })
    ).rejects.toThrow(/rate_limited/)
    expect(getPRForBranchOutcomeMock).not.toHaveBeenCalled()
  })

})
