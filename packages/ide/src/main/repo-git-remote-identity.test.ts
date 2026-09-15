import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gitExecFileAsync } from './git/runner'
import { probeGitRemoteIdentity } from './repo-git-remote-identity'

vi.mock('./git/runner', () => ({ gitExecFileAsync: vi.fn() }))

const gitlabRemote = 'origin\tgit@gitlab.example.com:team/orca.git (fetch)\n'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('probeGitRemoteIdentity', () => {
  it('resolves the canonical identity for a non-GitHub remote', async () => {
    vi.mocked(gitExecFileAsync).mockResolvedValue({ stdout: gitlabRemote, stderr: '' })

    await expect(probeGitRemoteIdentity('/repos/orca')).resolves.toEqual({
      status: 'resolved',
      identity: {
        canonicalKey: 'gitlab.example.com/team/orca',
        remoteName: 'origin',
        remoteUrl: 'git@gitlab.example.com:team/orca.git'
      }
    })
  })

  it('settles on no-remote when git answers with nothing usable', async () => {
    vi.mocked(gitExecFileAsync).mockResolvedValue({ stdout: '', stderr: '' })

    await expect(probeGitRemoteIdentity('/repos/orca')).resolves.toEqual({ status: 'no-remote' })
  })

  it('reports unavailable when the local git command fails', async () => {
    vi.mocked(gitExecFileAsync).mockRejectedValue(new Error('not a git repository'))

    await expect(probeGitRemoteIdentity('/repos/orca')).resolves.toEqual({ status: 'unavailable' })
  })

})
