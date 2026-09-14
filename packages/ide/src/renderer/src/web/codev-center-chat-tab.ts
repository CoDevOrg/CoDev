import { useAppStore } from '@/store'

type CodevCenterTabState = {
  tabsByWorktree: Record<string, { id: string; launchAgent?: unknown }[]>
  unifiedTabsByWorktree?: Record<string, { id: string; entityId?: string; viewMode?: string }[]>
}

/** The worktree's chat tab id. `viewMode` survives a paired host's tab mirror; `launchAgent` does not. */
export function codevChatTabIdInState(
  worktreeId: string,
  state: CodevCenterTabState
): string | null {
  const chat = state.unifiedTabsByWorktree?.[worktreeId]?.find((tab) => tab.viewMode === 'chat')
  if (chat) {
    return chat.entityId ?? chat.id
  }
  return state.tabsByWorktree[worktreeId]?.find((tab) => Boolean(tab.launchAgent))?.id ?? null
}

/** Put the worktree's chat back in the center when a plain terminal tab took it. */
export function frontCodevChatTab(worktreeId: string, fromTabId: string): void {
  const state = useAppStore.getState()
  const chatTabId = codevChatTabIdInState(worktreeId, state)
  if (!chatTabId || chatTabId === fromTabId) {
    return
  }
  state.setActiveTabForWorktree(worktreeId, chatTabId)
  if (state.activeWorktreeId === worktreeId) {
    state.setActiveTab(chatTabId)
  }
}
