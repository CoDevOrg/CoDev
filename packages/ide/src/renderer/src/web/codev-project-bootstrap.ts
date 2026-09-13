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
 * Puts a still-running conversation back on screen, and returns whether it
 * found one. Opening a workspace deliberately starts nothing: a member picks
 * the agent, so an empty workspace lands on the empty state instead of a
 * session some default chose for them.
 */
type RestoreChatTabs = (args: { worktreeId: string }) => boolean

/**
 * Resolves once a restored conversation is actually on screen. Only consulted
 * when there was something to restore.
 */
type WaitForDefaultChatTab = (args: { worktreeId: string }) => Promise<boolean>

const CODEV_ACTIVATION_ATTEMPTS = 46
const CODEV_ACTIVATION_RETRY_DELAY_MS = 2_000

function waitForCodevActivationRetry(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, CODEV_ACTIVATION_RETRY_DELAY_MS))
}

/**
 * Lets a surface rendered deep in the tree (the awaiting-workspace cover) ask
 * `App` to run the project handoff again. The handoff owns store actions and a
 * once-only ref that only `App` can reset, so the retry is registered there
 * rather than reconstructed at the call site.
 */
let codevProjectBootstrapRetry: (() => void) | null = null

export function registerCodevProjectBootstrapRetry(retry: (() => void) | null): void {
  codevProjectBootstrapRetry = retry
}

/** Returns false when no handoff is registered (stock Orca, or pre-mount). */
export function retryCodevProjectBootstrap(): boolean {
  if (!codevProjectBootstrapRetry) {
    return false
  }
  codevProjectBootstrapRetry()
  return true
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
  restoreChatTabs,
  waitForDefaultChatTab,
  waitForActivationRetry = waitForCodevActivationRetry
}: {
  projectPath: string
  projectKind: 'git' | 'folder'
  projectName?: string
  store: CodevProjectStore
  getStore: () => CodevProjectStore
  openDefaultCheckout: OpenDefaultCheckout
  activateDefaultCheckoutFromSidebar: ActivateDefaultCheckoutFromSidebar
  restoreChatTabs?: RestoreChatTabs
  waitForDefaultChatTab?: WaitForDefaultChatTab
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

  let activationFinished = false
  const finishActivation = async (worktreeId: string): Promise<boolean> => {
    if (activationFinished) {
      return true
    }
    activationFinished = true
    let restored = false
    try {
      restored = restoreChatTabs?.({ worktreeId }) ?? false
    } catch (error) {
      console.warn('CoDev could not restore the existing sessions:', error)
    }
    // Opening a workspace no longer starts a session, so an empty workspace is
    // a correct landing, not a failure — waiting for a chat surface here would
    // stall every open for the full poll budget before reporting ready.
    if (!restored) {
      return true
    }
    // A restored conversation should be on screen before the parent is told
    // the project opened.
    return waitForDefaultChatTab ? waitForDefaultChatTab({ worktreeId }) : true
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
