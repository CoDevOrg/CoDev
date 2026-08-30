import { describe, expect, it, vi } from 'vitest'
import { isCodevProjectBootstrapReady, openCodevProject } from './codev-project-bootstrap'

const projectPath = '/srv/codev/workspaces/c1f9fe13-6881-44a6-adbd-96bc5a946afa'

describe('isCodevProjectBootstrapReady', () => {
  it('waits for both session hydration and the deferred worktree refresh', () => {
    expect(
      isCodevProjectBootstrapReady({
        workspaceSessionReady: true,
        startupWorktreeRefreshCompleted: false
      })
    ).toBe(false)
    expect(
      isCodevProjectBootstrapReady({
        workspaceSessionReady: false,
        startupWorktreeRefreshCompleted: true
      })
    ).toBe(false)
    expect(
      isCodevProjectBootstrapReady({
        workspaceSessionReady: true,
        startupWorktreeRefreshCompleted: true
      })
    ).toBe(true)
  })
})

function createStore(
  repos: Array<{
    id: string
    path: string
    displayName: string
    executionHostId?: 'local' | `ssh:${string}` | `runtime:${string}` | null
  }> = []
) {
  return {
    repos,
    worktreesByRepo: {} as Record<
      string,
      Array<{
        id: string
        repoId: string
        isMainWorktree: boolean
        hostId?: 'local' | `ssh:${string}` | `runtime:${string}`
      }>
    >,
    activeWorktreeId: null as string | null,
    addRepoPath: vi.fn(),
    updateRepo: vi.fn().mockResolvedValue(true),
    setHideDefaultBranchWorkspace: vi.fn()
  }
}

describe('openCodevProject', () => {
  it('activates an existing project instead of leaving it unselected', async () => {
    const store = createStore([
      {
        id: 'repo-1',
        path: projectPath,
        displayName: 'workspace-id',
        executionHostId: 'runtime:environment-1'
      }
    ])
    store.worktreesByRepo['repo-1'] = [
      {
        id: 'worktree-1',
        repoId: 'repo-1',
        isMainWorktree: true,
        hostId: 'ssh:private-host'
      }
    ]
    const openDefaultCheckout = vi.fn().mockResolvedValue(undefined)
    const activateDefaultCheckoutFromSidebar = vi.fn(async (worktreeId: string) => {
      store.activeWorktreeId = worktreeId
    })

    await expect(
      openCodevProject({
        projectPath,
        projectKind: 'git',
        projectName: 'yousef20920/CoDev',
        store,
        getStore: () => store,
        openDefaultCheckout,
        activateDefaultCheckoutFromSidebar
      })
    ).resolves.toBe(true)

    expect(store.addRepoPath).not.toHaveBeenCalled()
    expect(store.updateRepo).toHaveBeenCalledWith('repo-1', {
      displayName: 'yousef20920/CoDev'
    })
    expect(openDefaultCheckout).toHaveBeenCalledWith({
      repoId: 'repo-1',
      source: 'runtime_server_path',
      setHideDefaultBranchWorkspace: store.setHideDefaultBranchWorkspace,
      executionHostId: 'runtime:environment-1'
    })
    expect(activateDefaultCheckoutFromSidebar).toHaveBeenCalledWith(
      'worktree-1',
      'ssh:private-host'
    )
  })

  it('opens the default chat tab once, after the checkout becomes active', async () => {
    const store = createStore([
      { id: 'repo-1', path: projectPath, displayName: 'yousef20920/CoDev' }
    ])
    store.worktreesByRepo['repo-1'] = [
      { id: 'worktree-1', repoId: 'repo-1', isMainWorktree: true }
    ]
    const openDefaultCheckout = vi.fn().mockResolvedValue(undefined)
    const activateDefaultCheckoutFromSidebar = vi.fn(async (worktreeId: string) => {
      store.activeWorktreeId = worktreeId
    })
    const launchDefaultChatTab = vi.fn()

    await expect(
      openCodevProject({
        projectPath,
        projectKind: 'git',
        store,
        getStore: () => store,
        openDefaultCheckout,
        activateDefaultCheckoutFromSidebar,
        launchDefaultChatTab
      })
    ).resolves.toBe(true)

    expect(launchDefaultChatTab).toHaveBeenCalledTimes(1)
    expect(launchDefaultChatTab).toHaveBeenCalledWith({ worktreeId: 'worktree-1' })
  })

  it('completes the handoff even when opening the default chat tab throws', async () => {
    const store = createStore([
      { id: 'repo-1', path: projectPath, displayName: 'yousef20920/CoDev' }
    ])
    store.worktreesByRepo['repo-1'] = [
      { id: 'worktree-1', repoId: 'repo-1', isMainWorktree: true }
    ]
    const openDefaultCheckout = vi.fn().mockResolvedValue(undefined)
    const activateDefaultCheckoutFromSidebar = vi.fn(async (worktreeId: string) => {
      store.activeWorktreeId = worktreeId
    })
    const launchDefaultChatTab = vi.fn(() => {
      throw new Error('agent launch failed')
    })

    await expect(
      openCodevProject({
        projectPath,
        projectKind: 'git',
        store,
        getStore: () => store,
        openDefaultCheckout,
        activateDefaultCheckoutFromSidebar,
        launchDefaultChatTab
      })
    ).resolves.toBe(true)

    expect(launchDefaultChatTab).toHaveBeenCalledTimes(1)
  })

  it('adds and activates a new project as one startup operation', async () => {
    const store = createStore()
    store.addRepoPath.mockResolvedValue({
      id: 'repo-2',
      path: projectPath,
      displayName: 'workspace-id',
      executionHostId: 'runtime:environment-2'
    })
    const openDefaultCheckout = vi.fn(async () => {
      store.worktreesByRepo['repo-2'] = [
        { id: 'worktree-2', repoId: 'repo-2', isMainWorktree: true }
      ]
    })
    const activateDefaultCheckoutFromSidebar = vi.fn(async (worktreeId: string) => {
      store.activeWorktreeId = worktreeId
    })

    await expect(
      openCodevProject({
        projectPath,
        projectKind: 'git',
        store,
        getStore: () => store,
        openDefaultCheckout,
        activateDefaultCheckoutFromSidebar
      })
    ).resolves.toBe(true)

    expect(store.addRepoPath).toHaveBeenCalledWith(projectPath, 'git')
    expect(openDefaultCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 'repo-2',
        executionHostId: 'runtime:environment-2'
      })
    )
    expect(activateDefaultCheckoutFromSidebar).toHaveBeenCalledWith(
      'worktree-2',
      'runtime:environment-2'
    )
  })

  it('retries activation while the hosted workspace is still waking', async () => {
    const store = createStore([
      { id: 'repo-3', path: projectPath, displayName: 'yousef20920/CoDev' }
    ])
    store.worktreesByRepo['repo-3'] = [{ id: 'worktree-3', repoId: 'repo-3', isMainWorktree: true }]
    const openDefaultCheckout = vi.fn().mockResolvedValue(undefined)
    const activateDefaultCheckoutFromSidebar = vi.fn(async (worktreeId: string) => {
      if (activateDefaultCheckoutFromSidebar.mock.calls.length === 3) {
        store.activeWorktreeId = worktreeId
      }
    })
    const waitForActivationRetry = vi.fn().mockResolvedValue(undefined)

    await expect(
      openCodevProject({
        projectPath,
        projectKind: 'git',
        store,
        getStore: () => store,
        openDefaultCheckout,
        activateDefaultCheckoutFromSidebar,
        waitForActivationRetry
      })
    ).resolves.toBe(true)

    expect(activateDefaultCheckoutFromSidebar).toHaveBeenCalledTimes(3)
    expect(waitForActivationRetry).toHaveBeenCalledTimes(2)
  })

  it('retries the complete handoff while the execution host is still booting', async () => {
    const store = createStore([
      { id: 'repo-4', path: projectPath, displayName: 'yousef20920/CoDev' }
    ])
    const openDefaultCheckout = vi.fn(async () => {
      if (openDefaultCheckout.mock.calls.length < 3) {
        throw new Error('execution host is not ready')
      }
      store.worktreesByRepo['repo-4'] = [
        { id: 'worktree-4', repoId: 'repo-4', isMainWorktree: true }
      ]
    })
    const activateDefaultCheckoutFromSidebar = vi.fn(async (worktreeId: string) => {
      store.activeWorktreeId = worktreeId
    })
    const waitForActivationRetry = vi.fn().mockResolvedValue(undefined)

    await expect(
      openCodevProject({
        projectPath,
        projectKind: 'git',
        store,
        getStore: () => store,
        openDefaultCheckout,
        activateDefaultCheckoutFromSidebar,
        waitForActivationRetry
      })
    ).resolves.toBe(true)

    expect(openDefaultCheckout).toHaveBeenCalledTimes(3)
    expect(activateDefaultCheckoutFromSidebar).toHaveBeenCalledTimes(1)
    expect(waitForActivationRetry).toHaveBeenCalledTimes(2)
  })

  it('reports failure when Orca cannot add the project', async () => {
    const store = createStore()
    store.addRepoPath.mockResolvedValue(null)
    const openDefaultCheckout = vi.fn()
    const activateDefaultCheckoutFromSidebar = vi.fn()

    await expect(
      openCodevProject({
        projectPath,
        projectKind: 'git',
        store,
        getStore: () => store,
        openDefaultCheckout,
        activateDefaultCheckoutFromSidebar
      })
    ).resolves.toBe(false)
    expect(openDefaultCheckout).not.toHaveBeenCalled()
    expect(activateDefaultCheckoutFromSidebar).not.toHaveBeenCalled()
  })
})
