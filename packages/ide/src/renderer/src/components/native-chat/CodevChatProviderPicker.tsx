import { memo } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import {
  codevChatProviders,
  codevChatProviderSwitchEnabled,
  isCodevChatProvider,
  switchCodevChatProvider
} from '@/web/codev-chat-provider-switch'
import type { AgentType } from '../../../../shared/agent-status-types'

export type CodevChatProviderPickerProps = {
  agent: AgentType
  terminalTabId: string
  /** Chat is mid-turn; switching now would abandon a running reply. */
  isWorking: boolean
}

/**
 * In CoDev-embedded mode, lets a member pick which linked coding subscription
 * the chat tab runs on — Claude or Codex — from the same row as the model and
 * reasoning-effort pickers. Choosing a different provider starts a fresh chat
 * on it in this worktree and retires the current tab (see
 * `switchCodevChatProvider`); the model and effort for the new provider are
 * then chosen from the pickers beside this one.
 */
function CodevChatProviderPickerInner({
  agent,
  terminalTabId,
  isWorking
}: CodevChatProviderPickerProps): React.JSX.Element | null {
  if (!codevChatProviderSwitchEnabled() || !isCodevChatProvider(agent)) {
    return null
  }
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={isWorking}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={`Provider ${formatAgentTypeLabel(agent)}`}
              className="max-w-48 text-muted-foreground"
            >
              <span className="truncate">{formatAgentTypeLabel(agent)}</span>
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {isWorking ? 'Wait for the reply to finish to switch provider' : 'Provider'}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuRadioGroup
          value={agent}
          onValueChange={(next) => {
            if (next !== agent && isCodevChatProvider(next)) {
              switchCodevChatProvider({ terminalTabId, nextAgent: next })
            }
          }}
        >
          {codevChatProviders().map((provider) => (
            <DropdownMenuRadioItem key={provider} value={provider} disabled={isWorking}>
              {formatAgentTypeLabel(provider)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const CodevChatProviderPicker = memo(CodevChatProviderPickerInner)
