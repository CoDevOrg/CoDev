import { FileDiff, Globe, MoreHorizontal, TerminalSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { cn } from '@/lib/utils'
import type { NativeChatSession } from '../../../../shared/native-chat-types'

export function CodevNativeChatHeader({
  agent,
  working,
  terminalOpen,
  onToggleTerminal,
  onOpenChanges,
  onOpenBrowser
}: {
  agent: NativeChatSession['agent']
  working: boolean
  terminalOpen: boolean
  onToggleTerminal: () => void
  onOpenChanges: () => void
  onOpenBrowser: () => void
}): React.JSX.Element {
  const agentLabel = formatAgentTypeLabel(agent)
  return (
    <div
      className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-3 py-1.5"
      data-codev-chat-header
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
          {agentLabel.slice(0, 2).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-col">
          <strong className="truncate text-xs font-semibold text-foreground">
            {agentLabel} session
          </strong>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span
              aria-hidden
              className={cn('size-1.5 rounded-full', working ? 'bg-amber-400' : 'bg-emerald-400')}
            />
            {working ? 'Working' : 'Ready'}
          </span>
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={terminalOpen}
            aria-label="Terminal"
            onClick={onToggleTerminal}
            className={cn(
              'h-8 gap-1.5 px-2 text-xs',
              terminalOpen ? 'bg-accent text-foreground' : 'text-muted-foreground'
            )}
          >
            <TerminalSquare className="size-4" />
            <span>Terminal</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {terminalOpen ? 'Hide terminal' : 'Show terminal'}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Changes"
            onClick={onOpenChanges}
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
          >
            <FileDiff className="size-4" />
            <span>Changes</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          Changes
        </TooltipContent>
      </Tooltip>
      <details className="relative">
        <summary
          className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="More workspace tools"
        >
          <MoreHorizontal className="size-4" />
        </summary>
        <div className="absolute right-0 top-9 z-30 min-w-36 rounded-lg border border-border bg-popover p-1 shadow-xl">
          <button
            type="button"
            onClick={onOpenBrowser}
            className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-popover-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Globe className="size-4" /> Browser
          </button>
        </div>
      </details>
    </div>
  )
}
