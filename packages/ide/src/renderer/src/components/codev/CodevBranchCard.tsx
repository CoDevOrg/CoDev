import type { JSX } from 'react'
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  CirclePause,
  CircleStop,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  UserRound,
  Users,
  WifiOff
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { cn } from '@/lib/utils'
import type { CodevBranchState, CodevBranchSummary } from './codev-branches-model'

const STATE_META: Record<
  CodevBranchState,
  { label: string; description: string; icon: LucideIcon; className: string }
> = {
  active: {
    label: 'Active',
    description: 'An agent is working here',
    icon: Bot,
    className: 'bg-accent text-accent-foreground'
  },
  provisioning: {
    label: 'Preparing',
    description: 'The branch is still being prepared',
    icon: LoaderCircle,
    className: 'bg-muted text-muted-foreground'
  },
  conflict: {
    label: 'Needs attention',
    description: 'A Git operation needs your attention',
    icon: TriangleAlert,
    className: 'bg-muted text-foreground'
  },
  syncing: {
    label: 'Syncing',
    description: 'The branch is syncing with its runtime',
    icon: RefreshCw,
    className: 'bg-muted text-foreground'
  },
  failed: {
    label: 'Unavailable',
    description: 'The branch could not be opened',
    icon: CircleAlert,
    className: 'bg-muted text-destructive'
  },
  paused: {
    label: 'Paused',
    description: 'The agent session is paused',
    icon: CirclePause,
    className: 'bg-muted text-foreground'
  },
  disconnected: {
    label: 'Disconnected',
    description: 'The branch runtime is offline',
    icon: WifiOff,
    className: 'bg-muted text-muted-foreground'
  },
  ready: {
    label: 'Ready',
    description: 'Ready to open',
    icon: CheckCircle2,
    className: 'bg-muted text-muted-foreground'
  },
  stopped: {
    label: 'Stopped',
    description: 'The agent session is stopped',
    icon: CircleStop,
    className: 'bg-muted text-muted-foreground'
  }
}

function activityLabel(timestamp: number, now: number): string {
  return timestamp > 0 ? formatUiRelativeTime(timestamp - now) : 'No activity yet'
}

function BranchMetric({
  label,
  value,
  icon: Icon
}: {
  label: string
  value: string
  icon: LucideIcon
}): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm text-foreground">{value}</dd>
    </div>
  )
}

export function CodevBranchCard({
  row,
  active,
  opening,
  now,
  onOpen
}: {
  row: CodevBranchSummary
  active: boolean
  opening: boolean
  now: number
  onOpen: (row: CodevBranchSummary) => void
}): JSX.Element {
  const meta = STATE_META[row.state]
  const StateIcon = meta.icon
  const canOpen = row.worktree !== null
  const agentLabel = row.agentCount === 1 ? '1 agent' : `${row.agentCount} agents`
  const changedLabel =
    row.changedFiles === null
      ? 'Checking changes…'
      : `${row.changedFiles} ${row.changedFiles === 1 ? 'file' : 'files'}`

  return (
    <li>
      <button
        type="button"
        disabled={!canOpen || opening}
        onClick={() => onOpen(row)}
        aria-current={active ? 'page' : undefined}
        aria-label={`${row.label}. ${meta.label}. Owned by ${row.owner}. ${agentLabel}. ${
          canOpen ? 'Open branch' : 'Preparing branch'
        }`}
        className={cn(
          'group flex min-h-[232px] w-full flex-col rounded-xl border p-5 text-left shadow-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'border-border/70 bg-card hover:border-foreground/25 hover:bg-accent/30',
          'disabled:cursor-wait disabled:opacity-70',
          active && 'border-primary bg-accent ring-1 ring-primary'
        )}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <h2 className="truncate text-base font-semibold tracking-tight text-foreground">
                {row.label}
              </h2>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {row.worktree?.isMainWorktree
                ? 'Workspace default branch'
                : 'Shared branch workspace'}
            </p>
          </div>
          <span
            className={cn(
              'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
              meta.className
            )}
            title={meta.description}
          >
            <StateIcon
              className={cn(
                'size-3.5',
                row.state === 'provisioning' && 'animate-spin motion-reduce:animate-none'
              )}
              aria-hidden="true"
            />
            {meta.label}
          </span>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5">
          <BranchMetric label="Owner" value={row.owner} icon={UserRound} />
          <BranchMetric label="Agents" value={agentLabel} icon={Users} />
          <BranchMetric
            label="Provider"
            value={
              row.provider
                ? `${row.provider}${row.providerReady === false ? ' · unavailable' : ''}`
                : 'No agent'
            }
            icon={Bot}
          />
          <BranchMetric label="Changed files" value={changedLabel} icon={CircleDot} />
        </dl>

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-border/60 pt-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Last activity
            </p>
            <p className="mt-1 truncate text-xs text-foreground">
              {activityLabel(row.lastActivityAt, now)}
              {row.agentStatus !== 'No agents' ? ` · ${row.agentStatus}` : ''}
            </p>
          </div>
          <span className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-medium text-primary">
            {opening ? 'Opening…' : canOpen ? 'Open branch' : 'Preparing branch…'}
            {canOpen ? (
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            ) : null}
          </span>
        </div>
        {row.providerReady === false ? (
          <p
            className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"
            role="status"
          >
            {row.providerIssue ?? 'Provider unavailable. Reconnect it before sending work.'}
          </p>
        ) : row.statusDetail && row.state !== 'ready' ? (
          <p className="mt-3 text-xs text-muted-foreground" role="status">
            {row.statusDetail}
          </p>
        ) : null}
      </button>
    </li>
  )
}
