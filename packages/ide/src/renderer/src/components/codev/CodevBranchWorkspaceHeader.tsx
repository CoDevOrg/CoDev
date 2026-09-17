import type { JSX } from 'react'
import {
  Bot,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  CirclePause,
  CircleStop,
  Files,
  GitBranch,
  History,
  LoaderCircle,
  Radio,
  RefreshCw,
  TerminalSquare,
  TriangleAlert,
  UserRound,
  Users,
  WifiOff
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { ActiveRightSidebarTab } from '@/store/slices/editor'
import { useActiveWorktree } from '@/store/selectors'
import { isCodevEmbedded } from '@/web/codev-embedded'
import { codevChatTabIdInState } from '@/web/codev-center-chat-tab'
import { requestCodevTerminalDrawerOpen } from '../native-chat/codev-terminal-drawer-event'
import { openCodevBranches } from './codev-branches-view'
import { codevBranchLabel, type CodevBranchState } from './codev-branches-model'
import { useCodevBranchRows } from './use-codev-branch-rows'

type HeaderState = CodevBranchState | 'loading'

const STATE_META: Record<HeaderState, { label: string; icon: LucideIcon; className: string }> = {
  active: { label: 'Active', icon: Bot, className: 'bg-accent text-accent-foreground' },
  provisioning: {
    label: 'Preparing',
    icon: LoaderCircle,
    className: 'bg-muted text-muted-foreground'
  },
  conflict: {
    label: 'Needs attention',
    icon: TriangleAlert,
    className: 'bg-muted text-foreground'
  },
  syncing: { label: 'Syncing', icon: RefreshCw, className: 'bg-muted text-foreground' },
  failed: { label: 'Unavailable', icon: CircleAlert, className: 'bg-muted text-destructive' },
  paused: { label: 'Paused', icon: CirclePause, className: 'bg-muted text-foreground' },
  disconnected: {
    label: 'Disconnected',
    icon: WifiOff,
    className: 'bg-muted text-muted-foreground'
  },
  ready: { label: 'Ready', icon: CircleCheck, className: 'bg-muted text-muted-foreground' },
  stopped: { label: 'Stopped', icon: CircleStop, className: 'bg-muted text-muted-foreground' },
  loading: { label: 'Loading', icon: LoaderCircle, className: 'bg-muted text-muted-foreground' }
}

function fallbackBranchLabel(activeWorktree: ReturnType<typeof useActiveWorktree>): string {
  return codevBranchLabel(activeWorktree, null)
}

function HeaderAction({
  label,
  icon: Icon,
  onClick,
  disabled = false
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          title={label}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-transparent px-2 text-muted-foreground transition-colors hover:border-border/70 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="hidden text-xs font-medium lg:inline">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** The persistent context bar for the currently selected branch workspace. */
export function CodevBranchWorkspaceHeader(): JSX.Element | null {
  const embedded = isCodevEmbedded()
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const rightSidebarOpen = useAppStore((state) => state.rightSidebarOpen)
  const activeChatTabId = useAppStore((state) => {
    const worktreeId = state.activeWorktreeId
    return worktreeId ? codevChatTabIdInState(worktreeId, state) : null
  })
  const activeWorktree = useActiveWorktree()
  const { rows } = useCodevBranchRows(embedded && Boolean(activeWorktreeId))

  if (!embedded || !activeWorktreeId) {
    return null
  }

  const row = rows.find((candidate) => candidate.id === activeWorktreeId)
  const label = row?.label ?? fallbackBranchLabel(activeWorktree)
  const owner = row?.owner ?? 'Checking owner…'
  const agents = row
    ? row.agentCount === 0
      ? 'No agents'
      : `${row.agentCount} ${row.agentCount === 1 ? 'agent' : 'agents'}`
    : 'Checking agents…'
  const state = row?.state ?? 'loading'
  const meta = STATE_META[state]
  const StateIcon = meta.icon

  const openRightSidebarTab = (tab: ActiveRightSidebarTab): void => {
    const store = useAppStore.getState()
    store.setRightSidebarTab(tab)
    store.setRightSidebarOpen(true)
  }

  return (
    <header
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4',
        !rightSidebarOpen && 'pr-12 sm:pr-14'
      )}
      data-codev-branch-shell="true"
      data-codev-branch-id={activeWorktreeId}
      aria-label={`Current branch workspace: ${label}`}
    >
      <button
        type="button"
        onClick={openCodevBranches}
        aria-label="Back to all branches"
        title="Back to all branches"
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg border border-border/70 px-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-w-0"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Branches</span>
      </button>

      <div className="min-w-0 flex-1 basis-[220px]">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground">
            {label}
          </h1>
          <span
            className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${meta.className}`}
            aria-label={`Branch state: ${meta.label}`}
          >
            <StateIcon
              className={`size-3.5 ${state === 'loading' || state === 'provisioning' ? 'animate-spin motion-reduce:animate-none' : ''}`}
              aria-hidden="true"
            />
            {meta.label}
          </span>
        </div>
        <div
          className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{owner}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3.5 shrink-0" aria-hidden="true" />
            {agents}
          </span>
          <span className="sr-only">{`${label} · ${owner} · ${agents} · ${meta.label}`}</span>
        </div>
      </div>

      <TooltipProvider delayDuration={400}>
        <nav className="flex shrink-0 items-center gap-0.5" aria-label="Current branch tools">
          <HeaderAction
            label="Explorer"
            icon={Files}
            onClick={() => useAppStore.getState().showRightSidebarFiles()}
          />
          <HeaderAction
            label="Source Control"
            icon={GitBranch}
            onClick={() => openRightSidebarTab('source-control')}
          />
          <HeaderAction
            label="Agents"
            icon={Radio}
            onClick={() => openRightSidebarTab('codev-agents')}
          />
          <HeaderAction
            label="Activity"
            icon={History}
            onClick={() => openRightSidebarTab('activity')}
          />
          <HeaderAction
            label="Terminal"
            icon={TerminalSquare}
            disabled={activeChatTabId === null}
            onClick={() => {
              requestCodevTerminalDrawerOpen(activeWorktreeId, activeChatTabId)
            }}
          />
        </nav>
      </TooltipProvider>
    </header>
  )
}
