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

import { createHostedReview } from './hosted-review-creation'

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

describe('createHostedReview', () => {
  beforeEach(() => {
    resetMocks()

    mockGitHubProvider()
    getHostedReviewForBranchMock.mockResolvedValue(null)
    ghExecFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })
    getUpstreamStatusMock.mockResolvedValue({
      hasUpstream: true,
      upstreamName: 'origin/feature',
      ahead: 0,
      behind: 0
    })
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') {
        return { stdout: 'feature\n', stderr: '' }
      }
      if (args[0] === 'status') {
        return { stdout: '', stderr: '' }
      }
      // Why: base-on-remote probe (Change 2 enforcement) — the default base
      // resolves to a remote-tracking branch so create-time validation passes.
      if (args[0] === 'for-each-ref') {
        return { stdout: 'refs/remotes/origin/main\n', stderr: '' }
      }
      if (args[0] === 'log' && args.includes('--pretty=%s')) {
        return { stdout: 'Feature title\n', stderr: '' }
      }
      if (args[0] === 'log') {
        return { stdout: '- Feature title\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    createGitHubPullRequestMock.mockResolvedValue({
      ok: true,
      number: 12,
      url: 'https://github.com/acme/orca/pull/12'
    })
  })

  it('revalidates ahead commits before creating a GitHub pull request', async () => {
    getUpstreamStatusMock.mockResolvedValue({
      hasUpstream: true,
      upstreamName: 'origin/feature',
      ahead: 1,
      behind: 0
    })

    await expect(
      createHostedReview('/repo', {
        provider: 'github',
        base: 'main',
        head: 'feature',
        title: 'Feature'
      })
    ).resolves.toEqual({
      ok: false,
      code: 'validation',
      error: 'Create PR failed: push this branch before creating a pull request.'
    })
    expect(createGitHubPullRequestMock).not.toHaveBeenCalled()
  })

  it('rejects creation when the selected head is no longer checked out', async () => {
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') {
        return { stdout: 'other-branch\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    await expect(
      createHostedReview('/repo', {
        provider: 'github',
        base: 'main',
        head: 'feature',
        title: 'Feature'
      })
    ).resolves.toEqual({
      ok: false,
      code: 'validation',
      error: 'Create PR failed: switch back to the selected branch before creating a pull request.'
    })
    expect(createGitHubPullRequestMock).not.toHaveBeenCalled()
  })

  it('blocks creation with actionable copy when the submitted base is local-only', async () => {
    // for-each-ref falls through to '' → the submitted stacked parent is not on
    // the remote, so create-time enforcement blocks with actionable copy.
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') {
        return { stdout: 'feature\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    await expect(
      createHostedReview('/repo', {
        provider: 'github',
        base: 'stacked-parent',
        head: 'feature',
        title: 'Feature'
      })
    ).resolves.toEqual({
      ok: false,
      code: 'validation',
      error:
        'Create PR failed: the base branch "stacked-parent" hasn\'t been pushed to the remote. Choose a pushed base or push it first.'
    })
    expect(createGitHubPullRequestMock).not.toHaveBeenCalled()
  })

  it('creates the pull request after fresh main-process validation passes', async () => {
    await expect(
      createHostedReview('/repo', {
        provider: 'github',
        base: 'main',
        head: 'feature',
        title: 'Feature'
      })
    ).resolves.toEqual({
      ok: true,
      number: 12,
      url: 'https://github.com/acme/orca/pull/12'
    })
    expect(createGitHubPullRequestMock).toHaveBeenCalledOnce()
  })

  it('routes local WSL git and GitHub review creation through the selected runtime', async () => {
    await expect(
      createHostedReview(
        '/repo',
        {
          provider: 'github',
          base: 'main',
          head: 'feature',
          title: 'Feature'
        },
        null,
        { localGitExecOptions: { wslDistro: 'Ubuntu' } }
      )
    ).resolves.toEqual({
      ok: true,
      number: 12,
      url: 'https://github.com/acme/orca/pull/12'
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: '/repo',
      wslDistro: 'Ubuntu'
    })
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['status', '--porcelain', '-z'],
      expect.objectContaining({ cwd: '/repo', wslDistro: 'Ubuntu' })
    )
    expect(getUpstreamStatusMock).toHaveBeenCalledWith('/repo', undefined, {
      wslDistro: 'Ubuntu'
    })
    expect(getRepoSlugMock).toHaveBeenCalledWith('/repo', null, {
      localGitExecOptions: { wslDistro: 'Ubuntu' }
    })
    expect(getHostedReviewForBranchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: '/repo',
        branch: 'feature',
        localGitExecOptions: { wslDistro: 'Ubuntu' },
        // Why: a stale no-review answer here would leave Create enabled after a
        // review was opened outside Orca, so eligibility takes the fast tier.
        active: true
      })
    )
    expect(ghExecFileAsyncMock).toHaveBeenCalledWith(
      ['auth', 'status', '--hostname', 'github.com'],
      { cwd: '/repo', wslDistro: 'Ubuntu', host: 'github.com' }
    )
    expect(createGitHubPullRequestMock).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ provider: 'github', head: 'feature' }),
      null,
      { localGitExecOptions: { wslDistro: 'Ubuntu' } }
    )
  })

  it('creates a pull request on a GitHub Enterprise Server remote (#8312)', async () => {
    mockGitHubEnterpriseProvider()

    await expect(
      createHostedReview('/repo', {
        provider: 'github',
        base: 'main',
        head: 'feature',
        title: 'Feature'
      })
    ).resolves.toEqual({
      ok: true,
      number: 12,
      url: 'https://github.com/acme/orca/pull/12'
    })

    // Detection already confirmed gh is authed to the GHES host, so the auth
    // gate must not fire a second (rate-limited) gh probe.
    expect(ghExecFileAsyncMock).not.toHaveBeenCalled()
    expect(createGitHubPullRequestMock).toHaveBeenCalled()
  })

  it('uses the SSH git provider for remote hosted-review preflight', async () => {
    const remoteGit = {
      getStatus: vi.fn(async () => ({ entries: [], conflictOperation: 'unknown' })),
      getUpstreamStatus: vi.fn(async () => ({
        hasUpstream: true,
        upstreamName: 'origin/feature',
        ahead: 0,
        behind: 0
      })),
      exec: vi.fn(async (args: string[]) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref' && args[2] === 'HEAD') {
          return { stdout: 'feature\n', stderr: '' }
        }
        if (args[0] === 'for-each-ref') {
          // Base-on-remote probe (Change 2) runs on the SSH host; base is pushed.
          return { stdout: 'refs/remotes/origin/main\n', stderr: '' }
        }
        if (args[0] === 'log' && args.includes('--pretty=%s')) {
          return { stdout: 'Feature title\n', stderr: '' }
        }
        if (args[0] === 'log') {
          return { stdout: '- Feature title\n', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })
    }
    getSshGitProviderMock.mockReturnValue(remoteGit)

    await expect(
      createHostedReview(
        '/remote/repo',
        {
          provider: 'github',
          base: 'main',
          head: 'feature',
          title: 'Feature'
        },
        'ssh-1'
      )
    ).resolves.toEqual({
      ok: true,
      number: 12,
      url: 'https://github.com/acme/orca/pull/12'
    })

    expect(remoteGit.exec).toHaveBeenCalledWith(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      '/remote/repo'
    )
    expect(remoteGit.getStatus).toHaveBeenCalledWith('/remote/repo')
    expect(remoteGit.exec).not.toHaveBeenCalledWith(['status', '--porcelain'], '/remote/repo')
    expect(remoteGit.getUpstreamStatus).toHaveBeenCalledWith('/remote/repo')
    expect(remoteGit.exec).not.toHaveBeenCalledWith(
      ['rev-list', '--left-right', '--count', 'HEAD...@{u}'],
      '/remote/repo'
    )
    expect(getUpstreamStatusMock).not.toHaveBeenCalled()
    expect(ghExecFileAsyncMock).toHaveBeenCalledWith(
      ['auth', 'status', '--hostname', 'github.com'],
      { host: 'github.com' }
    )
    expect(createGitHubPullRequestMock).toHaveBeenCalledWith(
      '/remote/repo',
      {
        provider: 'github',
        base: 'main',
        head: 'feature',
        title: 'Feature'
      },
      'ssh-1'
    )
  })

  it('returns the existing review instead of creating a duplicate', async () => {
    getHostedReviewForBranchMock.mockResolvedValue({
      provider: 'github',
      number: 31,
      title: 'Existing feature',
      state: 'open',
      url: 'https://github.com/acme/orca/pull/31',
      status: 'pending',
      updatedAt: '2026-05-15T00:00:00.000Z',
      mergeable: 'UNKNOWN'
    })

    await expect(
      createHostedReview('/repo', {
        provider: 'github',
        base: 'main',
        head: 'feature',
        title: 'Feature'
      })
    ).resolves.toEqual({
      ok: false,
      code: 'already_exists',
      error: 'A pull request already exists for this branch.',
      existingReview: {
        number: 31,
        url: 'https://github.com/acme/orca/pull/31'
      }
    })
    expect(createGitHubPullRequestMock).not.toHaveBeenCalled()
  })
})
