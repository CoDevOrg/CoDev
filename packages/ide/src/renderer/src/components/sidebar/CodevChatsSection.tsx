import type { JSX } from 'react'
import { CodevChatHistorySection } from '@/components/right-sidebar/CodevChatHistorySection'
import { useCodevNewChat } from '@/components/codev/codev-new-chat'
import { isCodevEmbedded } from '@/web/codev-embedded'

/** The workspace's chats, in the top half of the left rail. Discoverability:
 *  a member should see their conversations without opening a panel. */
export function CodevChatsSection(): JSX.Element | null {
  const { startNewChat, pending, canStart } = useCodevNewChat()
  if (!isCodevEmbedded()) {
    return null
  }
  return (
    <CodevChatHistorySection
      className="in-left-rail"
      onNewChat={() => void startNewChat()}
      newChatPending={pending}
      canStartNewChat={canStart}
    />
  )
}

export default CodevChatsSection
