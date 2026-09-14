import { useSyncExternalStore } from 'react'

/** Worktrees with a default-chat launch in flight. Without this, "no agent
 *  tab" was read as "an agent is coming", so stopping one still said
 *  "Still starting your assistant". */

const launching = new Set<string>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function markCodevAgentLaunching(worktreeId: string): void {
  if (launching.has(worktreeId)) {
    return
  }
  launching.add(worktreeId)
  emit()
}

export function clearCodevAgentLaunching(worktreeId: string): void {
  if (!launching.delete(worktreeId)) {
    return
  }
  emit()
}

export function isCodevAgentLaunching(worktreeId: string): boolean {
  return launching.has(worktreeId)
}

export function subscribeCodevAgentLaunching(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useCodevAgentLaunching(worktreeId: string): boolean {
  return useSyncExternalStore(
    subscribeCodevAgentLaunching,
    () => isCodevAgentLaunching(worktreeId),
    () => false
  )
}

export function resetCodevAgentLaunchStateForTest(): void {
  launching.clear()
  listeners.clear()
}
