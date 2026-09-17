import { useSyncExternalStore } from 'react'
import { isCodevEmbedded } from '@/web/codev-embedded'

const listeners = new Set<() => void>()
let branchesOpen =
  typeof window !== 'undefined' &&
  isCodevEmbedded() &&
  window.__CODEV_SETTINGS_ONLY__ !== true &&
  !window.__CODEV_BRANCH__

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): boolean {
  return branchesOpen
}

export function useCodevBranchesOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export function openCodevBranches(): void {
  setCodevBranchSelection(null)
  if (branchesOpen) {
    return
  }
  branchesOpen = true
  emit()
}

export function closeCodevBranches(): void {
  if (!branchesOpen) {
    return
  }
  branchesOpen = false
  emit()
}

export function toggleCodevBranches(): void {
  if (branchesOpen) {
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
