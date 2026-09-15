import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPullRequestLinkedIssue } from './pull-request-linked-issue'

const mocks = vi.hoisted(() => ({
  getGitHubIssue: vi.fn()
}))

vi.mock('../github/issues', () => ({ getIssue: mocks.getGitHubIssue }))

describe('loadPullRequestLinkedIssue', () => {
  beforeEach(() => {
    mocks.getGitHubIssue.mockReset()
  })

  it('loads a GitHub issue title and description', async () => {
    mocks.getGitHubIssue.mockResolvedValue({
      number: 12,
      title: 'Stop phantom polling',
      description: 'Do not stat Linux-only paths on macOS.'
    })

    await expect(
      loadPullRequestLinkedIssue({
        meta: { linkedIssue: 12 },
        provider: 'github',
        repoPath: '/repo'
      })
    ).resolves.toEqual({
      provider: 'github',
      number: 12,
      title: 'Stop phantom polling',
      description: 'Do not stat Linux-only paths on macOS.'
    })
  })

  it('infers the GitHub provider from the linked work item when none is given', async () => {
    mocks.getGitHubIssue.mockResolvedValue({ number: 12, title: 'Issue', description: '' })

    await expect(
      loadPullRequestLinkedIssue({
        meta: {
          linkedIssue: 12,
          linkedWorkItem: {
            provider: 'github',
            type: 'issue',
            number: 12,
            title: 'Issue',
            url: 'https://github.com/acme/repo/issues/12'
          }
        },
        repoPath: '/repo'
      })
    ).resolves.toMatchObject({ provider: 'github', number: 12 })
  })

  it('uses persisted work-item title when the provider lookup fails', async () => {
    mocks.getGitHubIssue.mockResolvedValue(null)

    await expect(
      loadPullRequestLinkedIssue({
        meta: {
          linkedIssue: 12,
          linkedWorkItem: {
            provider: 'github',
            type: 'issue',
            number: 12,
            title: 'Cached title',
            url: 'https://github.com/acme/repo/issues/12'
          }
        },
        provider: 'github',
        repoPath: '/repo'
      })
    ).resolves.toMatchObject({ title: 'Cached title', description: '' })
  })

  it('does not attach a GitHub issue to an unsupported-provider review', async () => {
    await expect(
      loadPullRequestLinkedIssue({
        meta: { linkedIssue: 12 },
        provider: 'unsupported',
        repoPath: '/repo'
      })
    ).resolves.toBeNull()
    expect(mocks.getGitHubIssue).not.toHaveBeenCalled()
  })
})
