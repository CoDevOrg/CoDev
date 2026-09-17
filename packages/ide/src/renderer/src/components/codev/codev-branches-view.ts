import { useAppStore } from '@/store'
import { isCodevEmbedded } from '@/web/codev-embedded'

export function useCodevBranchesOpen(): boolean {
  const rightSidebarOpen = useAppStore((state) => state.rightSidebarOpen)
  const rightSidebarTab = useAppStore((state) => state.rightSidebarTab)
  return (
    isCodevEmbedded() &&
    typeof window !== 'undefined' &&
    window.__CODEV_SETTINGS_ONLY__ !== true &&
    rightSidebarOpen &&
    rightSidebarTab === 'codev-branches'
  )
}

export function openCodevBranches(): void {
  if (
    typeof window === 'undefined' ||
    !isCodevEmbedded() ||
    window.__CODEV_SETTINGS_ONLY__ === true
  ) {
    return
  }
  setCodevBranchSelection(null)
  const store = useAppStore.getState()
  store.setRightSidebarTab('codev-branches')
  store.setRightSidebarOpen(true)
}

export function closeCodevBranches(): void {
  const store = useAppStore.getState()
  if (store.rightSidebarTab !== 'codev-branches') {
    return
  }
  // Keep the sidebar mounted with the Agents tab selected. The Branches tab
  // remains one click away and the center chat never gets covered.
  store.setRightSidebarTab('codev-agents')
}

export function toggleCodevBranches(): void {
  const store = useAppStore.getState()
  if (store.rightSidebarOpen && store.rightSidebarTab === 'codev-branches') {
    closeCodevBranches()
    return
  }
  openCodevBranches()
}

/**
 * Keep the embedded client and the owning workspace URL on the same branch.
 * The URL is replaced, rather than pushed, because choosing a branch is a
 * selection inside one workspace—not a new browser-history page.
 */
export function setCodevBranchSelection(branch: string | null): void {
  const normalized = branch?.trim() ?? ''
  if (typeof window === 'undefined') {
    return
  }
  window.__CODEV_BRANCH__ = normalized || undefined
  window.__CODEV_AGENT__ = undefined
  if (!isCodevEmbedded() || window.parent === window) {
    return
  }
  window.parent.postMessage(
    { type: 'codev:branch-route', branch: normalized || null },
    window.location.origin
  )
}

/** Keep the agent detail route tied to the currently selected branch. */
export function setCodevAgentSelection(agent: string | null): void {
  const normalized = agent?.trim() ?? ''
  if (typeof window === 'undefined') {
    return
  }
  window.__CODEV_AGENT__ = normalized || undefined
  if (!isCodevEmbedded() || window.parent === window) {
    return
  }
  window.parent.postMessage(
    {
      type: 'codev:agent-route',
      branch: window.__CODEV_BRANCH__ ?? null,
      agent: normalized || null
    },
    window.location.origin
  )
}
