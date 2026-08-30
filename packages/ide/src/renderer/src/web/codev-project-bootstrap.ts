type CodevProjectRepo = {
  id: string
  path: string
  displayName: string
  executionHostId?: 'local' | `ssh:${string}` | `runtime:${string}` | null
}

type CodevProjectWorktree = {
  id: string
  repoId: string
  isMainWorktree: boolean
  hostId?: 'local' | `ssh:${string}` | `runtime:${string}`
}

type CodevProjectStore = {
  repos: CodevProjectRepo[]
  worktreesByRepo: Record<string, CodevProjectWorktree[]>
  activeWorktreeId: string | null
  addRepoPath: (path: string, kind: 'git' | 'folder') => Promise<CodevProjectRepo | null>
  updateRepo: (repoId: string, update: { displayName: string }) => Promise<boolean>
  setHideDefaultBranchWorkspace: (value: boolean) => void
}

type ActivateDefaultCheckoutFromSidebar = (
  worktreeId: string,
  executionHostId?: 'local' | `ssh:${string}` | `runtime:${string}`
) => Promise<void>

type OpenDefaultCheckout = (args: {
  repoId: string
  source: 'runtime_server_path'
  setHideDefaultBranchWorkspace: (value: boolean) => void
  executionHostId?: 'local' | `ssh:${string}` | `runtime:${string}`
}) => Promise<void>

/**
 * Opens the workspace's default chat tab in the just-activated worktree.
 *
 * CoDev workspaces are agent-first: the surface a member lands on when a
 * workspace opens is a native chat, not an idle shell. This runs once per
 * project handoff, immediately after the default checkout becomes the active
 * worktree, and is a no-op when that worktree already has an agent tab (e.g. a
 * reload that mirrored a still-running session).
 */
type LaunchDefaultChatTab = (args: { worktreeId: string }) => void | Promise<void>

const CODEV_ACTIVATION_ATTEMPTS = 46
const CODEV_ACTIVATION_RETRY_DELAY_MS = 2_000

function waitForCodevActivationRetry(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, CODEV_ACTIVATION_RETRY_DELAY_MS))
}

export function isCodevProjectBootstrapReady({
  workspaceSessionReady,
  startupWorktreeRefreshCompleted
}: {
  workspaceSessionReady: boolean
  startupWorktreeRefreshCompleted: boolean
}): boolean {
  return workspaceSessionReady && startupWorktreeRefreshCompleted
}

export async function openCodevProject({
  projectPath,
  projectKind,
  projectName,
  store,
  getStore,
  openDefaultCheckout,
  activateDefaultCheckoutFromSidebar,
  launchDefaultChatTab,
  waitForActivationRetry = waitForCodevActivationRetry
}: {
  projectPath: string
  projectKind: 'git' | 'folder'
  projectName?: string
  store: CodevProjectStore
  getStore: () => CodevProjectStore
  openDefaultCheckout: OpenDefaultCheckout
  activateDefaultCheckoutFromSidebar: ActivateDefaultCheckoutFromSidebar
  launchDefaultChatTab?: LaunchDefaultChatTab
  waitForActivationRetry?: () => Promise<void>
}): Promise<boolean> {
  const repo =
    store.repos.find((candidate) => candidate.path === projectPath) ??
    (await store.addRepoPath(projectPath, projectKind))
  if (!repo) {
    return false
  }
  if (projectName && repo.displayName !== projectName) {
    await store.updateRepo(repo.id, { displayName: projectName })
  }

  let defaultChatTabLaunched = false
  const finishActivation = async (worktreeId: string): Promise<true> => {
    if (!defaultChatTabLaunched) {
      defaultChatTabLaunched = true
      try {
        await launchDefaultChatTab?.({ worktreeId })
      } catch (error) {
        // The workspace is usable without the chat tab; the member can open one
        // by hand. Never fail the whole handoff on it.
        console.warn('CoDev could not open the default chat tab:', error)
      }
    }
    return true
  }

  for (let attempt = 0; attempt < CODEV_ACTIVATION_ATTEMPTS; attempt += 1) {
    try {
      await openDefaultCheckout({
        repoId: repo.id,
        source: 'runtime_server_path',
        setHideDefaultBranchWorkspace: store.setHideDefaultBranchWorkspace,
        ...(repo.executionHostId ? { executionHostId: repo.executionHostId } : {})
      })

      const defaultCheckout = getStore().worktreesByRepo[repo.id]?.find(
        (worktree) => worktree.isMainWorktree
      )
      if (defaultCheckout) {
        if (getStore().activeWorktreeId === defaultCheckout.id) {
          return finishActivation(defaultCheckout.id)
        }
        await activateDefaultCheckoutFromSidebar(
          defaultCheckout.id,
          defaultCheckout.hostId ?? repo.executionHostId ?? undefined
        )
        if (getStore().activeWorktreeId === defaultCheckout.id) {
          return finishActivation(defaultCheckout.id)
        }
      }
    } catch (error) {
      console.warn('CoDev project handoff is waiting for its execution host:', error)
    }
    if (attempt < CODEV_ACTIVATION_ATTEMPTS - 1) {
      await waitForActivationRetry()
    }
  }
  return false
}
