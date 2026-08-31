import { History, MessageSquare, TriangleAlert } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import {
  NATIVE_CHAT_EMPTY_STATE_COPY,
  NATIVE_CHAT_REOPEN_PREVIOUS_CONVERSATION_LABEL
} from '../../../../shared/native-chat-empty-state'
import type { NativeChatSession } from '../../../../shared/native-chat-types'

export function NativeChatEmptyState({
  kind,
  message,
  agent,
  onReopenPreviousConversation
}: {
  kind: 'loading' | 'empty' | 'error' | 'not-agent'
  message?: string
  agent?: NativeChatSession['agent']
  /** When set, the empty and error states offer a one-click path to Agent
   *  Session History so a member can resume a chat that did not restore. */
  onReopenPreviousConversation?: () => void
}): React.JSX.Element {
  const copy = emptyStateCopy(kind, message, agent)
  const showReopen =
    Boolean(onReopenPreviousConversation) && (kind === 'empty' || kind === 'error')
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div
        className={
          kind === 'error'
            ? 'flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive'
            : 'flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground'
        }
      >
        {kind === 'error' ? (
          <TriangleAlert className="size-6" />
        ) : (
          <MessageSquare className="size-6" />
        )}
      </div>
      <p className="text-sm font-medium text-foreground">{copy.title}</p>
      {copy.subtitle ? (
        <p className="max-w-sm text-balance text-xs text-muted-foreground">{copy.subtitle}</p>
      ) : null}
      {showReopen ? (
        <button
          type="button"
          onClick={onReopenPreviousConversation}
          className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          <History className="size-3.5" />
          {translate(
            'components.native-chat.state.reopenPreviousConversation',
            NATIVE_CHAT_REOPEN_PREVIOUS_CONVERSATION_LABEL
          )}
        </button>
      ) : null}
    </div>
  )
}

function emptyStateCopy(
  kind: 'loading' | 'empty' | 'error' | 'not-agent',
  message?: string,
  agent?: NativeChatSession['agent']
): { title: string; subtitle: string | null } {
  switch (kind) {
    case 'loading':
      return {
        title: translate(
          'components.native-chat.state.loading.title',
          NATIVE_CHAT_EMPTY_STATE_COPY.loading.title
        ),
        subtitle: translate(
          'components.native-chat.state.loading.subtitle',
          NATIVE_CHAT_EMPTY_STATE_COPY.loading.subtitle
        )
      }
    case 'error':
      return {
        title: translate(
          'components.native-chat.state.error.title',
          NATIVE_CHAT_EMPTY_STATE_COPY.error.title
        ),
        subtitle:
          message ??
          translate(
            'components.native-chat.state.error.subtitle',
            NATIVE_CHAT_EMPTY_STATE_COPY.error.subtitle
          )
      }
    case 'not-agent':
      return {
        title: translate(
          'components.native-chat.state.notAgent.title',
          NATIVE_CHAT_EMPTY_STATE_COPY.notAgent.title
        ),
        subtitle: translate(
          'components.native-chat.state.notAgent.subtitle',
          NATIVE_CHAT_EMPTY_STATE_COPY.notAgent.subtitle
        )
      }
    case 'empty': {
      const agentName = agent ? formatAgentTypeLabel(agent) : 'the agent'
      return {
        title: translate(
          'components.native-chat.state.empty.title',
          NATIVE_CHAT_EMPTY_STATE_COPY.empty.title,
          { value0: agentName }
        ),
        subtitle: translate(
          'components.native-chat.state.empty.subtitle',
          NATIVE_CHAT_EMPTY_STATE_COPY.empty.subtitle,
          { value0: agentName }
        )
      }
    }
  }
}
