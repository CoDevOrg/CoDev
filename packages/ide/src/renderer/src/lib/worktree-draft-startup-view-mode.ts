import { useAppStore } from '@/store'
import { decideInitialAgentTabViewMode } from '@/lib/native-chat-initial-view-mode'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'

export function resolveBackendDraftStartup(
  request: WorktreeCreationRequest
): WorktreeCreationRequest['startup'] {
  if (!request.startup || !request.agent || !request.launchDraftPrompt) {
    return request.startup
  }
  const state = useAppStore.getState()
  const viewMode =
    decideInitialAgentTabViewMode({
      experimentalNativeChat: state.settings?.experimentalNativeChat,
      openAgentTabsInChatByDefault: state.settings?.openAgentTabsInChatByDefault,
      agent: request.agent,
      promptDelivery: 'draft',
      launchDraftText: request.launchDraftPrompt
    }) ?? 'terminal'
  return { ...request.startup, viewMode }
}
