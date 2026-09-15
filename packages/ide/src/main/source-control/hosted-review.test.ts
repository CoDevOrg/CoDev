import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getHostedReviewForBranch } from './hosted-review'
import { __resetHostedReviewBranchCacheForTests } from './hosted-review-branch-cache'

const { getRepoSlugMock, getPRForBranchOutcomeMock } = vi.hoisted(() => ({
  getRepoSlugMock: vi.fn(),
  getPRForBranchOutcomeMock: vi.fn()
}))

vi.mock('../github/client', () => ({
  getRepoSlug: getRepoSlugMock,
  getPRForBranchOutcome: getPRForBranchOutcomeMock,
  getGitHubPRLookupRateLimitBlock: vi.fn(async () => null),
  createGitHubPullRequest: vi.fn()
}))

vi.mock('../git/remote-url-probe', () => ({
  assertRemoteUrlReadable: vi.fn(async () => undefined)
}))

describe('getHostedReviewForBranch', () => {
  beforeEach(() => {
    getRepoSlugMock.mockReset()
    getPRForBranchOutcomeMock.mockReset()
    // The branch cache is process-wide, so one test's answer would otherwise
    // satisfy the next one's lookup.
    __resetHostedReviewBranchCacheForTests()
  })

  it('maps GitHub pull requests into the hosted review surface', async () => {
    getRepoSlugMock.mockResolvedValue({ owner: 'o', repo: 'r' })
    getPRForBranchOutcomeMock.mockResolvedValue({
      kind: 'found',
      fetchedAt: 1,
      pr: {
        number: 3,
        title: 'GitHub branch',
        state: 'open',
        url: 'https://github.com/o/r/pull/3',
        checksStatus: 'pending',
        updatedAt: '2026-05-10T00:00:00.000Z',
        mergeable: 'UNKNOWN'
      }
    })

    await expect(
      getHostedReviewForBranch({
        repoPath: '/repo',
        branch: 'refs/heads/feature',
        linkedGitHubPR: 3
      })
    ).resolves.toMatchObject({
      provider: 'github',
      number: 3,
      status: 'pending'
    })
    expect(getRepoSlugMock).toHaveBeenCalledWith('/repo', undefined)
    expect(getPRForBranchOutcomeMock).toHaveBeenCalledWith('/repo', 'feature', 3, undefined, null, {
      currentHeadOid: null
    })
  })

  it('routes local WSL project branch lookup through provider detection and the selected provider', async () => {
    getRepoSlugMock.mockResolvedValue({ owner: 'o', repo: 'r' })
    getPRForBranchOutcomeMock.mockResolvedValue({
      kind: 'found',
      fetchedAt: 1,
      pr: {
        number: 22,
        title: 'GitHub WSL branch',
        state: 'open',
        url: 'https://github.com/o/r/pull/22',
        checksStatus: 'pending',
        updatedAt: '2026-06-16T00:00:00.000Z',
        mergeable: 'UNKNOWN'
      }
    })

    await expect(
      getHostedReviewForBranch({
        repoPath: '/repo',
        branch: 'feature/wsl',
        linkedGitHubPR: 22,
        localGitExecOptions: { wslDistro: 'Ubuntu' }
      })
    ).resolves.toMatchObject({
      provider: 'github',
      number: 22,
      status: 'pending'
    })

    const executionOptions = { localGitExecOptions: { wslDistro: 'Ubuntu' } }
    expect(getRepoSlugMock).toHaveBeenCalledWith('/repo', undefined, executionOptions)
    expect(getPRForBranchOutcomeMock).toHaveBeenCalledWith(
      '/repo',
      'feature/wsl',
      22,
      undefined,
      null,
      { ...executionOptions, currentHeadOid: null }
    )
  })

  it('uses fallback GitHub PR when branch is empty', async () => {
    getRepoSlugMock.mockResolvedValue({ owner: 'o', repo: 'r' })
    getPRForBranchOutcomeMock.mockResolvedValue({
      kind: 'found',
      fetchedAt: 1,
      pr: {
        number: 42,
        title: 'Detached GitHub branch',
        state: 'open',
        url: 'https://github.com/o/r/pull/42',
        checksStatus: 'success',
        updatedAt: '2026-05-10T00:00:00.000Z',
        mergeable: 'MERGEABLE'
      }
    })

    await expect(
      getHostedReviewForBranch({
        repoPath: '/repo',
        branch: '',
        fallbackGitHubPR: 42
      })
    ).resolves.toMatchObject({
      provider: 'github',
      number: 42,
      status: 'success'
    })
    expect(getPRForBranchOutcomeMock).toHaveBeenCalledWith('/repo', '', null, undefined, 42, {
      acceptMergedFallbackPR: true,
      currentHeadOid: null
    })
  })

  it('returns null when no hosted provider claims the remote', async () => {
    getRepoSlugMock.mockResolvedValue(null)

    await expect(
      getHostedReviewForBranch({ repoPath: '/repo', branch: 'feature' })
    ).resolves.toBeNull()
    expect(getPRForBranchOutcomeMock).not.toHaveBeenCalled()
  })
})
