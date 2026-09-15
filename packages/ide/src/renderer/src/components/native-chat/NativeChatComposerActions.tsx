import { ArrowUp, Plus, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat-session-options'
import type { AgentType } from '../../../../shared/agent-status-types'
import { NativeChatSessionOptionPickers } from './NativeChatSessionOptionPickers'
import { CodevChatProviderPicker } from './CodevChatProviderPicker'

export type NativeChatComposerActionsProps = {
  agent: AgentType
  terminalTabId: string
  attachDisabled: boolean
  sendDisabled: boolean
  isWorking: boolean
  onAttach: () => void
  onSend: () => void
  onStop?: () => void
  sessionOptionsSurface: SessionOptionsSurface | null
  sessionOptionsSnapshot: SessionOptionDescriptor[]
}

export function NativeChatComposerActions({
  agent,
  terminalTabId,
  attachDisabled,
  sendDisabled,
  isWorking,
  onAttach,
  onSend,
  onStop,
  sessionOptionsSurface,
  sessionOptionsSnapshot
}: NativeChatComposerActionsProps): React.JSX.Element {
  return (
    // Why: wrap, not overlap — in a narrow chat column the pickers used to paint over the attach button.
    <div className="flex w-full flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <div className="flex min-w-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={translate('components.native-chat.composer.attach', 'Attach file')}
              disabled={attachDisabled}
              onClick={onAttach}
              className="pointer-coarse:size-11"
            >
              <Plus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {translate('components.native-chat.composer.attach', 'Attach file')}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
        {/* Why: keep session controls beside the actions they affect; the
        model trigger is ordered last so it sits directly next to Send. */}
        <CodevChatProviderPicker
          agent={agent}
          terminalTabId={terminalTabId}
          isWorking={isWorking}
        />
        <NativeChatSessionOptionPickers
          surface={sessionOptionsSurface}
          snapshot={sessionOptionsSnapshot}
          isWorking={isWorking}
        />
        <Button
          type="button"
          aria-label={
            isWorking
              ? translate('components.native-chat.stop', 'Stop the agent')
              : translate('components.native-chat.composer.send', 'Send')
          }
          disabled={sendDisabled}
          onClick={isWorking ? onStop : onSend}
          variant={isWorking ? 'secondary' : 'default'}
          size="icon"
          className="size-8 rounded-full pointer-coarse:size-11"
        >
          {isWorking ? (
            <Square className="size-3.5 fill-current" />
          ) : (
            <ArrowUp className="size-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
