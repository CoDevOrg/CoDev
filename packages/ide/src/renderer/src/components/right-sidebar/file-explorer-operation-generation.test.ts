import { afterEach, describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../shared/types'
import { useAppStore } from '@/store'
import { } from '../../../../shared/workspace-scope'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import {
  captureFileExplorerOperationGuard,
  getFileExplorerOperationOwner
} from './file-explorer-operation-owner'

const initialState = useAppStore.getInitialState()
const worktreeId = 'repo-1::/srv/project'

function worktree(hostId: Worktree['hostId'], runtimeOwnerEnvironmentId?: string): Worktree {
  return {
    id: worktreeId,
    repoId: 'repo-1',
    path: '/srv/project',
    hostId,
    runtimeOwnerEnvironmentId
  } as Worktree
}

afterEach(() => {
  useAppStore.getState().setRuntimeEnvironments([])
  useAppStore.setState(initialState, true)
})

describe('file explorer operation generations', () => {
  it('routes floating workspace file mutations to the local host', () => {
    const owner = getFileExplorerOperationOwner(FLOATING_TERMINAL_WORKTREE_ID)
    const guard = captureFileExplorerOperationGuard(FLOATING_TERMINAL_WORKTREE_ID, owner)

    expect(owner).toEqual({ kind: 'local' })
    expect(guard.route.expectedExecutionHostId).toBe('local')
    expect(() => guard.assertCurrent()).not.toThrow()
  })

  it('invalidates a mutation when the saved HUB points at a replacement runtime', () => {
    useAppStore.setState({
      repos: [],
      worktreesByRepo: { 'repo-1': [worktree('local', 'hub-a')] }
    })
    useAppStore.getState().setRuntimeEnvironmentStatus('hub-a', {
      status: { runtimeId: 'runtime-a' } as never,
      checkedAt: 1
    })
    const owner = getFileExplorerOperationOwner(worktreeId)
    const guard = captureFileExplorerOperationGuard(worktreeId, owner)

    useAppStore.getState().setRuntimeEnvironmentStatus('hub-a', {
      status: { runtimeId: 'runtime-b' } as never,
      checkedAt: 2
    })

    expect(() => guard.assertCurrent()).toThrow("Couldn't determine which host owns")
  })

  it('fails closed when nested SSH ownership has no authoritative generation', () => {
    useAppStore.setState({
      repos: [],
      worktreesByRepo: { 'repo-1': [worktree('ssh:private-target', 'hub-a')] }
    })
    const owner = getFileExplorerOperationOwner(worktreeId)

    expect(() => captureFileExplorerOperationGuard(worktreeId, owner)).toThrow(
      "Couldn't determine which host owns"
    )
  })

  it('invalidates a mutation when the same saved HUB id is re-paired', () => {
    useAppStore.setState({
      repos: [],
      worktreesByRepo: { 'repo-1': [worktree('local', 'hub-a')] }
    })
    useAppStore
      .getState()
      .setRuntimeEnvironments([{ id: 'hub-a', createdAt: 1, pairingRevision: 1 } as never])
    const owner = getFileExplorerOperationOwner(worktreeId)
    const guard = captureFileExplorerOperationGuard(worktreeId, owner)

    useAppStore
      .getState()
      .setRuntimeEnvironments([{ id: 'hub-a', createdAt: 1, pairingRevision: 2 } as never])

    expect(() => guard.assertCurrent()).toThrow("Couldn't determine which host owns")
  })
})
