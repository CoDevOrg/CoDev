import { deriveGitRemoteIdentity, type GitRemoteIdentity } from '../shared/git-remote-identity'
import { gitExecFileAsync } from './git/runner'

/** `no-remote` means git answered and the repo has no usable remote;
 *  `unavailable` means the probe never reached git and says nothing about the repo. */
export type GitRemoteIdentityProbe =
  | { status: 'resolved'; identity: GitRemoteIdentity }
  | { status: 'no-remote' }
  | { status: 'unavailable' }

export async function probeGitRemoteIdentity(
  repoPath: string,
  _connectionId?: string | null
): Promise<GitRemoteIdentityProbe> {
  try {
    const result = await gitExecFileAsync(['remote', '-v'], { cwd: repoPath })
    const identity = deriveGitRemoteIdentity(result.stdout)
    return identity ? { status: 'resolved', identity } : { status: 'no-remote' }
  } catch {
    // Repo creation must not fail because a best-effort remote probe failed.
    return { status: 'unavailable' }
  }
}

export async function detectGitRemoteIdentity(
  repoPath: string,
  connectionId?: string | null
): Promise<GitRemoteIdentity | null> {
  const probe = await probeGitRemoteIdentity(repoPath, connectionId)
  return probe.status === 'resolved' ? probe.identity : null
}
