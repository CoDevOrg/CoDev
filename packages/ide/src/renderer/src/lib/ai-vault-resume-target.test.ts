import { describe, expect, it } from 'vitest'
import type { AppState } from '@/store/types'
import {
  canResumeAiVaultSessionOnTarget,
  getAiVaultResumeWorkspaceExecutionHostId,
  getAiVaultResumeWorktreeTargetStatus,
  getAiVaultResumeWorkspaceTargetStatus,
  isWslStoredAiVaultSessionFile
} from './ai-vault-resume-target'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'

type ResumeTargetState = Pick<
  AppState,
  'folderWorkspaces' | 'projectGroups' | 'repos' | 'worktreesByRepo'
>

function makeState(
  overrides: Partial<Record<keyof ResumeTargetState, unknown>>
): ResumeTargetState {
  return {
    folderWorkspaces: [],
    projectGroups: [],
    repos: [],
    worktreesByRepo: {},
    ...overrides
  } as unknown as ResumeTargetState
}

describe('ai vault session storage compatibility', () => {
  const hostSessionFile = '/Users/ada/.claude/projects/-Users-ada-repo/session-1.jsonl'
  const windowsHostSessionFile = 'C:\\Users\\ada\\.claude\\projects\\C--repo\\session-1.jsonl'
  const wslSessionFile = '\\\\wsl$\\Ubuntu\\home\\ada\\.claude\\projects\\-home-ada-repo\\s-1.jsonl'
  const wslLocalhostSessionFile =
    '\\\\wsl.localhost\\Ubuntu\\home\\ada\\.claude\\projects\\-home-ada-repo\\s-1.jsonl'

  it('detects WSL-stored session files', () => {
    expect(isWslStoredAiVaultSessionFile(wslSessionFile)).toBe(true)
    expect(isWslStoredAiVaultSessionFile(wslLocalhostSessionFile)).toBe(true)
    expect(isWslStoredAiVaultSessionFile(hostSessionFile)).toBe(false)
    expect(isWslStoredAiVaultSessionFile(windowsHostSessionFile)).toBe(false)
    expect(isWslStoredAiVaultSessionFile(null)).toBe(false)
    expect(isWslStoredAiVaultSessionFile(undefined)).toBe(false)
  })

  it('allows runtime sessions only on the matching runtime target', () => {
    expect(
      canResumeAiVaultSessionOnTarget({
        sessionFilePath: '/home/ada/.codex/sessions/remote.jsonl',
        sessionExecutionHostId: 'runtime:env-1',
        targetStatus: 'runtime',
        targetExecutionHostId: 'runtime:env-1'
      })
    ).toBe(true)
    expect(
      canResumeAiVaultSessionOnTarget({
        sessionFilePath: '/home/ada/.codex/sessions/remote.jsonl',
        sessionExecutionHostId: 'runtime:env-1',
        targetStatus: 'runtime',
        targetExecutionHostId: 'runtime:env-2'
      })
    ).toBe(false)
    expect(
      canResumeAiVaultSessionOnTarget({
        sessionFilePath: wslSessionFile,
        targetStatus: 'runtime',
        targetExecutionHostId: 'runtime:env-1'
      })
    ).toBe(false)
  })

  it('never allows unknown targets', () => {
    expect(
      canResumeAiVaultSessionOnTarget({ sessionFilePath: hostSessionFile, targetStatus: 'unknown' })
    ).toBe(false)
  })
})

describe('ai vault resume target ownership', () => {

  it('resolves runtime-owned worktree targets through their repo owner', () => {
    expect(
      getAiVaultResumeWorktreeTargetStatus({
        worktreeId: 'repo-1::/repo/orca',
        worktrees: [{ id: 'repo-1::/repo/orca', repoId: 'repo-1' }],
        repos: [{ id: 'repo-1', connectionId: null, executionHostId: 'runtime:env-1' }]
      })
    ).toBe('runtime')
  })

  it('uses the composite worktree repo id when worktree discovery is incomplete', () => {
    expect(
      getAiVaultResumeWorkspaceTargetStatus(
        makeState({
          repos: [{ id: 'repo-1', connectionId: null, executionHostId: 'runtime:env-1' }]
        }),
        'repo-1::/repo/orca'
      )
    ).toBe('runtime')
  })

  it('resolves explicit workspace keys through the target worktree owner', () => {
    expect(
      getAiVaultResumeWorkspaceTargetStatus(
        makeState({
          worktreesByRepo: {
            'repo-1': [{ id: 'repo-1::/repo/orca', repoId: 'repo-1' }]
          },
          repos: [{ id: 'repo-1', connectionId: null, executionHostId: 'runtime:env-1' }]
        }),
        'worktree:repo-1::/repo/orca'
      )
    ).toBe('runtime')
  })

  it('resolves explicit workspace keys through the target worktree host', () => {
    expect(
      getAiVaultResumeWorkspaceTargetStatus(
        makeState({
          worktreesByRepo: {
            'repo-1': [{ id: 'repo-1::/repo/orca', repoId: 'repo-1', hostId: 'runtime:env-1' }]
          },
          repos: [{ id: 'repo-1', connectionId: 'ssh-1', executionHostId: 'ssh:ssh-1' }]
        }),
        'worktree:repo-1::/repo/orca'
      )
    ).toBe('runtime')
  })

  it('resolves exact execution host ids for active workspaces', () => {
    const state = makeState({
      worktreesByRepo: {
        'repo-1': [{ id: 'repo-1::/repo/orca', repoId: 'repo-1', hostId: 'ssh:ssh-1' }]
      },
      repos: [{ id: 'repo-1', connectionId: null, executionHostId: 'local' }]
    })

    expect(getAiVaultResumeWorkspaceExecutionHostId(state, 'repo-1::/repo/orca')).toBe('ssh:ssh-1')
    expect(getAiVaultResumeWorkspaceExecutionHostId(state, 'worktree:repo-1::/repo/orca')).toBe(
      'ssh:ssh-1'
    )
  })

  it('resolves local execution host ids for local workspaces', () => {
    expect(
      getAiVaultResumeWorkspaceExecutionHostId(
        makeState({
          worktreesByRepo: {
            'repo-1': [{ id: 'repo-1::/repo/orca', repoId: 'repo-1' }]
          },
          repos: [{ id: 'repo-1', connectionId: null, executionHostId: 'local' }]
        }),
        'repo-1::/repo/orca'
      )
    ).toBe('local')
  })

  it('prefers runtime project-group ownership over stale SSH folder connection ids', () => {
    expect(
      getAiVaultResumeWorkspaceTargetStatus(
        makeState({
          folderWorkspaces: [
            {
              id: 'folder-1',
              projectGroupId: 'group-1',
              name: 'Platform',
              folderPath: '/repo/platform',
              connectionId: 'ssh-1'
            }
          ],
          projectGroups: [
            { id: 'group-1', connectionId: 'ssh-1', executionHostId: 'runtime:env-1' }
          ]
        }),
        folderWorkspaceKey('folder-1')
      )
    ).toBe('runtime')
  })

  it('treats mixed local and SSH folder workspace targets as unknown', () => {
    expect(
      getAiVaultResumeWorkspaceTargetStatus(
        makeState({
          folderWorkspaces: [
            {
              id: 'folder-1',
              projectGroupId: 'group-1',
              name: 'Platform',
              folderPath: '/repo/platform'
            }
          ],
          projectGroups: [{ id: 'group-1' }],
          repos: [
            { id: 'repo-local', path: '/repo/platform/web', connectionId: null },
            { id: 'repo-ssh', path: '/repo/platform/api', connectionId: 'ssh-1' }
          ]
        }),
        folderWorkspaceKey('folder-1')
      )
    ).toBe('unknown')
  })

  it('blocks folder workspaces owned by runtime project groups', () => {
    expect(
      getAiVaultResumeWorkspaceTargetStatus(
        makeState({
          folderWorkspaces: [
            {
              id: 'folder-1',
              projectGroupId: 'group-1',
              name: 'Platform',
              folderPath: '/repo/platform'
            }
          ],
          projectGroups: [{ id: 'group-1', executionHostId: 'runtime:env-1' }]
        }),
        folderWorkspaceKey('folder-1')
      )
    ).toBe('runtime')
  })

  it('blocks mixed local and runtime folder workspace targets', () => {
    expect(
      getAiVaultResumeWorkspaceTargetStatus(
        makeState({
          folderWorkspaces: [
            {
              id: 'folder-1',
              projectGroupId: 'group-1',
              name: 'Platform',
              folderPath: '/repo/platform'
            }
          ],
          projectGroups: [{ id: 'group-1' }],
          repos: [
            { id: 'repo-local', path: '/repo/platform/web', connectionId: null },
            {
              id: 'repo-runtime',
              path: '/repo/platform/api',
              connectionId: null,
              executionHostId: 'runtime:env-1'
            }
          ]
        }),
        folderWorkspaceKey('folder-1')
      )
    ).toBe('runtime')
  })
})
