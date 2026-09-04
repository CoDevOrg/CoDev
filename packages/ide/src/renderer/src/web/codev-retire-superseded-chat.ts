import { useAppStore } from '@/store'

/** Long enough for a paired host to mirror the replacement tab back, since a
 *  web-runtime launch only appears once the host reports it. */
const RETIRE_SUPERSEDED_DELAY_MS = 2_000
const RETIRE_SUPERSEDED_ATTEMPTS = 6

function agentTabIdsInWorktree(worktreeId: string): string[] {
  const state = useAppStore.getState()
  const chatTabIds = new Set<string>()
  for (const tab of state.unifiedTabsByWorktree?.[worktreeId] ?? []) {
    if (tab.viewMode !== 'chat') {
      continue
    }
    chatTabIds.add(tab.id)
    if (tab.entityId) {
      chatTabIds.add(tab.entityId)
    }
  }
  return (state.tabsByWorktree[worktreeId] ?? [])
    .filter((tab) => Boolean(tab.launchAgent) || chatTabIds.has(tab.id))
    .map((tab) => tab.id)
}

/**
 * Snapshot a worktree's agent tabs so a launch that supersedes them can close
 * them once the replacement is really up.
 *
 * Reopening a past chat resumes it in the worktree the transcript belongs to,
 * but as a *second* agent process next to the idle one already sitting there.
 * Nothing ever retired the old one, so a member who reopened three chats
 * finished with three live agents — and CoDev's own Mission Control counted
 * every one of them, which is how a workspace reached "3 / 3" without the
 * member ever deliberately starting an agent.
 *
 * Returns a function to call after the launch. It waits for the replacement to
 * appear before closing anything, so a launch that fails silently cannot leave
 * the worktree with no agent at all.
 */
export function supersedeWorktreeAgentTabs(worktreeId: string): () => void {
  const previousTabIds = new Set(agentTabIdsInWorktree(worktreeId))

  return () => {
    if (previousTabIds.size === 0) {
      return
    }
    let attempt = 0
    const timer = setInterval(() => {
      attempt += 1
      const currentIds = agentTabIdsInWorktree(worktreeId)
      const replacementArrived = currentIds.some((id) => !previousTabIds.has(id))
      if (replacementArrived) {
        const state = useAppStore.getState()
        for (const id of currentIds) {
          if (previousTabIds.has(id)) {
            state.closeTab(id, { reason: 'user' })
          }
        }
        clearInterval(timer)
        return
      }
      if (attempt >= RETIRE_SUPERSEDED_ATTEMPTS) {
        clearInterval(timer)
      }
    }, RETIRE_SUPERSEDED_DELAY_MS)
  }
}
