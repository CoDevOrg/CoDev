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
  repos: {
    id: string
    path: string
    displayName: string
    executionHostId?: 'local' | `ssh:${string}` | `runtime:${string}` | null
  }[] = []
) {
  return {
    repos,
    worktreesByRepo: {} as Record<
      string,
      {
        id: string
        repoId: string
        isMainWorktree: boolean
        hostId?: 'local' | `ssh:${string}` | `runtime:${string}`
      }[]
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

  it('restores sessions once, after the checkout becomes active', async () => {
    const store = createStore([
      { id: 'repo-1', path: projectPath, displayName: 'yousef20920/CoDev' }
    ])
    store.worktreesByRepo['repo-1'] = [{ id: 'worktree-1', repoId: 'repo-1', isMainWorktree: true }]
    const openDefaultCheckout = vi.fn().mockResolvedValue(undefined)
    const activateDefaultCheckoutFromSidebar = vi.fn(async (worktreeId: string) => {
      store.activeWorktreeId = worktreeId
    })
    const restoreChatTabs = vi.fn(() => false)

    await expect(
      openCodevProject({
        projectPath,
        projectKind: 'git',
        store,
        getStore: () => store,
        openDefaultCheckout,
        activateDefaultCheckoutFromSidebar,
        restoreChatTabs
      })
    ).resolves.toBe(true)

    expect(restoreChatTabs).toHaveBeenCalledTimes(1)
    expect(restoreChatTabs).toHaveBeenCalledWith({ worktreeId: 'worktree-1' })
  })

  /**
   * Opening a workspace must not start anything. A member picks the agent, so
   * an empty workspace reports ready and lands on the empty state rather than
   * waiting out the chat-surface poll for a session nobody asked for.
   */
  it('reports ready without waiting when there is nothing to restore', async () => {
    const store = createStore([
      { id: 'repo-1', path: projectPath, displayName: 'yousef20920/CoDev' }
    ])
    store.worktreesByRepo['repo-1'] = [{ id: 'worktree-1', repoId: 'repo-1', isMainWorktree: true }]
    const activateDefaultCheckoutFromSidebar = vi.fn(async (worktreeId: string) => {
      store.activeWorktreeId = worktreeId
    })
    const waitForDefaultChatTab = vi.fn(async () => true)

    await expect(
      openCodevProject({
        projectPath,
        projectKind: 'git',
        store,
        getStore: () => store,
        openDefaultCheckout: vi.fn().mockResolvedValue(undefined),
        activateDefaultCheckoutFromSidebar,
        restoreChatTabs: vi.fn(() => false),
        waitForDefaultChatTab
      })
    ).resolves.toBe(true)

    expect(waitForDefaultChatTab).not.toHaveBeenCalled()
  })

  it('waits for a restored conversation to be on screen before reporting ready', async () => {
    const store = createStore([
      { id: 'repo-1', path: projectPath, displayName: 'yousef20920/CoDev' }
    ])
    store.worktreesByRepo['repo-1'] = [{ id: 'worktree-1', repoId: 'repo-1', isMainWorktree: true }]
    const activateDefaultCheckoutFromSidebar = vi.fn(async (worktreeId: string) => {
      store.activeWorktreeId = worktreeId
    })
    const waitForDefaultChatTab = vi.fn(async () => true)

    await expect(
      openCodevProject({
        projectPath,
        projectKind: 'git',
        store,
        getStore: () => store,
        openDefaultCheckout: vi.fn().mockResolvedValue(undefined),
        activateDefaultCheckoutFromSidebar,
        restoreChatTabs: vi.fn(() => true),
        waitForDefaultChatTab
      })
    ).resolves.toBe(true)

    expect(waitForDefaultChatTab).toHaveBeenCalledWith({ worktreeId: 'worktree-1' })
  })

  it('completes the handoff even when restoring sessions throws', async () => {
    const store = createStore([
      { id: 'repo-1', path: projectPath, displayName: 'yousef20920/CoDev' }
    ])
    store.worktreesByRepo['repo-1'] = [{ id: 'worktree-1', repoId: 'repo-1', isMainWorktree: true }]
    const openDefaultCheckout = vi.fn().mockResolvedValue(undefined)
    const activateDefaultCheckoutFromSidebar = vi.fn(async (worktreeId: string) => {
      store.activeWorktreeId = worktreeId
    })
    const restoreChatTabs = vi.fn(() => {
      throw new Error('session restore failed')
    })

    await expect(
      openCodevProject({
        projectPath,
        projectKind: 'git',
        store,
        getStore: () => store,
        openDefaultCheckout,
        activateDefaultCheckoutFromSidebar,
        restoreChatTabs
      })
    ).resolves.toBe(true)

    expect(restoreChatTabs).toHaveBeenCalledTimes(1)
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

  it('reports failure when a restored conversation never appears', async () => {
    const store = createStore([{ id: 'repo-5', path: projectPath, displayName: 'workspace-id' }])
    store.worktreesByRepo['repo-5'] = [{ id: 'worktree-5', repoId: 'repo-5', isMainWorktree: true }]
    // Restore claimed a live session, so one has to reach the screen. Nothing
    // to restore is a successful open now and is covered separately.
    const restoreChatTabs = vi.fn(() => true)
    const waitForDefaultChatTab = vi.fn().mockResolvedValue(false)

    await expect(
      openCodevProject({
        projectPath,
        projectKind: 'git',
        store,
        getStore: () => store,
        openDefaultCheckout: vi.fn(async () => {
          store.activeWorktreeId = 'worktree-5'
        }),
        activateDefaultCheckoutFromSidebar: vi.fn(),
        restoreChatTabs,
        waitForDefaultChatTab
      })
    ).resolves.toBe(false)

    expect(restoreChatTabs).toHaveBeenCalledWith({ worktreeId: 'worktree-5' })
    expect(waitForDefaultChatTab).toHaveBeenCalledWith({ worktreeId: 'worktree-5' })
  })

  it('reports success once a chat surface exists', async () => {
    const store = createStore([{ id: 'repo-6', path: projectPath, displayName: 'workspace-id' }])
    store.worktreesByRepo['repo-6'] = [{ id: 'worktree-6', repoId: 'repo-6', isMainWorktree: true }]

    await expect(
      openCodevProject({
        projectPath,
        projectKind: 'git',
        store,
        getStore: () => store,
        openDefaultCheckout: vi.fn(async () => {
          store.activeWorktreeId = 'worktree-6'
        }),
        activateDefaultCheckoutFromSidebar: vi.fn(),
        restoreChatTabs: vi.fn(() => false),
        waitForDefaultChatTab: vi.fn().mockResolvedValue(true)
      })
    ).resolves.toBe(true)
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
