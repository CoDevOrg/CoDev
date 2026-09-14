import { useState, type JSX } from 'react'
import { CodevChatHistorySection } from '@/components/right-sidebar/CodevChatHistorySection'
import { useCodevNewChat } from '@/components/codev/codev-new-chat'
import AgentCombobox from '@/components/agent/AgentCombobox'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { isNativeChatSupportedAgent } from '@/lib/native-chat-supported-agent'
import { isCodevEmbedded } from '@/web/codev-embedded'
import type { TuiAgent } from '../../../../shared/types'

/** The workspace's sessions, in the top half of the left rail. Discoverability:
 *  a member should see their conversations without opening a panel. */
export function CodevChatsSection(): JSX.Element | null {
  const { startNewChat, pending, canStart } = useCodevNewChat()
  // Never pre-selected: picking the agent is how a session starts, so the
  // member chooses rather than inheriting whichever one CoDev defaulted to.
  const [agent, setAgent] = useState<TuiAgent | null>(null)

  if (!isCodevEmbedded()) {
    return null
  }

  const agents = getAgentCatalog().filter((entry) => isNativeChatSupportedAgent(entry.id))

  return (
    <CodevChatHistorySection
      className="in-left-rail"
      newChatPending={pending}
      canStartNewChat={canStart}
      newChatAction={
        <AgentCombobox
          agents={agents}
          value={agent}
          onValueChange={setAgent}
          onValueSelected={(selected) => {
            if (!selected || !canStart || pending) {
              return
            }
            void startNewChat(selected)
            // Back to unselected so the next session is chosen just as deliberately.
            setAgent(null)
          }}
          triggerClassName="codev-chat-history-new"
          emptyLabel={pending ? 'Starting…' : 'New session'}
          allowNarrowTrigger
        />
      }
    />
  )
}

export default CodevChatsSection
