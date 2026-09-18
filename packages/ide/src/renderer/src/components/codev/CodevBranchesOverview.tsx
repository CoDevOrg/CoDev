/* eslint-disable max-lines -- The workspace landing surface owns its states, routing, and live branch list. */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  CircleAlert,
  GitBranchPlus,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  WifiOff
} from 'lucide-react'
import { useNow } from '@/components/dashboard/useNow'
import { activateWorktreeFromSidebar } from '@/lib/sidebar-worktree-activation'
import { isCodevEmbedded } from '@/web/codev-embedded'
import { CodevBranchCard } from './CodevBranchCard'
import {
  closeCodevBranches,
  openCodevBranches,
  setCodevBranchSelection,
  useCodevBranchesOpen
} from './codev-branches-view'
import type { CodevBranchSummary } from './codev-branches-model'
import { useCodevBranchRows } from './use-codev-branch-rows'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function branchMatchesRoute(row: CodevBranchSummary, requestedBranch: string): boolean {
  const normalize = (value: string): string => value.trim().replace(/^refs\/heads\//, '')
  return normalize(row.gitBranch) === normalize(requestedBranch)
}

export function CodevBranchesOverview({
  onCreateBranch
}: {
  onCreateBranch?: () => void
} = {}): JSX.Element | null {
  const embedded = isCodevEmbedded()
  const open = useCodevBranchesOpen()
  const initialBranch = typeof window !== 'undefined' ? (window.__CODEV_BRANCH__?.trim() ?? '') : ''
  const {
    rows,
    activeWorktreeId,
    projectLoading,
    workspaceReady,
    bridge,
    status,
    workboardError,
    sharedSessionsError,
    rosterError,
    refreshing,
    refresh,
    retry
  } = useCodevBranchRows(embedded && (open || Boolean(initialBranch)))
  const now = useNow(30_000)
  const initialBranchAttemptedRef = useRef(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)
  useEffect(() => {
    if (
      !embedded ||
      !initialBranch ||
      initialBranchAttemptedRef.current ||
      !workspaceReady ||
      projectLoading
    ) {
      return
    }
    const target = rows.find((row) => branchMatchesRoute(row, initialBranch))
    initialBranchAttemptedRef.current = true
    if (!target) {
      setRouteError(`Branch “${initialBranch}” was not found in this workspace.`)
      openCodevBranches()
      return
    }
    if (!target.worktree) {
      setRouteError(`Branch “${initialBranch}” is still being prepared. Try again shortly.`)
      openCodevBranches()
      return
    }
    setOpeningId(target.id)
    void activateWorktreeFromSidebar(target.worktree.id, target.worktree.hostId)
      .then(() => {
        setCodevBranchSelection(target.gitBranch || target.label)
        closeCodevBranches()
      })
      .catch((error: unknown) => {
        setRouteError(errorMessage(error, 'CoDev could not open that branch.'))
        openCodevBranches()
      })
      .finally(() => setOpeningId(null))
  }, [embedded, initialBranch, projectLoading, rows, workspaceReady])

  const openBranch = useCallback(
    async (row: CodevBranchSummary) => {
      if (!row.worktree || openingId) {
        return
      }
      setOpeningId(row.id)
      setRouteError(null)
      try {
        await activateWorktreeFromSidebar(row.worktree.id, row.worktree.hostId)
        setCodevBranchSelection(row.gitBranch || row.label)
        closeCodevBranches()
      } catch (error: unknown) {
        setRouteError(errorMessage(error, 'CoDev could not open that branch.'))
      } finally {
        setOpeningId(null)
      }
    },
    [openingId]
  )

  if (!embedded || !open) {
    return null
  }

  const loading = !workspaceReady || projectLoading || status.feed.phase === 'loading'
  const hasRows = rows.length > 0
  const liveDataError = workboardError ?? sharedSessionsError
  const showFullFailure = !hasRows && !loading && status.feed.phase === 'failed'
  const showFullDisconnected =
    !hasRows && !loading && !showFullFailure && status.feed.phase === 'reconnecting'
  const showEmpty = !hasRows && !loading && !showFullFailure && !showFullDisconnected
  const branchCountLabel = `${rows.length} ${rows.length === 1 ? 'branch' : 'branches'}`

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground"
      data-codev-branches="true"
      aria-labelledby="codev-branches-title"
      aria-describedby="codev-branches-description"
    >
      <header className="flex shrink-0 flex-col gap-3 border-b border-border/70 px-3 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            CoDev workspace
          </p>
          <h1 id="codev-branches-title" className="mt-1 text-lg font-semibold tracking-tight">
            Branches
          </h1>
          <p id="codev-branches-description" className="mt-1 text-xs text-muted-foreground">
            Every active branch has one shared place for code, chat, agents, and changes.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onCreateBranch ? (
            <button
              type="button"
              onClick={onCreateBranch}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border/70 px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <GitBranchPlus className="size-4" aria-hidden="true" />
              New branch
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || bridge.status !== 'connected'}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border/70 px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw
              className={refreshing ? 'size-4 animate-spin motion-reduce:animate-none' : 'size-4'}
              aria-hidden="true"
            />
            Refresh
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 pt-5 sm:px-8">
          <p className="px-3 pt-3 text-xs text-muted-foreground" role="status" aria-live="polite">
            {loading ? 'Loading branch workspaces…' : `${branchCountLabel} in this workspace`}
          </p>
          {bridge.status !== 'connected' ? (
            <div
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-muted px-3 text-xs text-foreground"
              role="status"
            >
              <WifiOff className="size-4 shrink-0" aria-hidden="true" />
              <span>
                {bridge.status === 'reconnecting'
                  ? 'Live branch data is reconnecting.'
                  : 'Live branch data is disconnected.'}
              </span>
              <button
                type="button"
                onClick={retry}
                className="min-h-8 rounded-md px-2 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Retry
              </button>
            </div>
          ) : null}
        </div>

        {liveDataError && hasRows ? (
          <div
            className="mx-3 mt-3 flex shrink-0 items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-3 text-xs text-destructive"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Live collaboration status could not be refreshed. The branch list may be stale.
            </span>
            <button
              type="button"
              onClick={retry}
              className="ml-auto min-h-8 shrink-0 rounded-md px-2 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Try again
            </button>
          </div>
        ) : null}
        {status.feed.phase === 'reconciling' ? (
          <p
            className="mx-3 mt-3 rounded-lg border border-border/70 bg-muted px-3 py-3 text-xs text-muted-foreground"
            role="status"
          >
            Branch and agent status are being reconciled. Capacity and agent counts will appear when
            both feeds agree.
          </p>
        ) : null}
        {routeError ? (
          <div
            className="mx-3 mt-3 flex shrink-0 items-start gap-2 rounded-lg border border-border bg-muted px-3 py-3 text-xs text-foreground"
            role="alert"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{routeError}</span>
            <button
              type="button"
              onClick={() => setRouteError(null)}
              className="ml-auto min-h-8 shrink-0 rounded-md px-2 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {loading ? (
          <div
            className="flex min-h-0 flex-1 items-center justify-center p-8"
            role="status"
            aria-live="polite"
          >
            <div className="flex max-w-sm flex-col items-center gap-3 p-3 text-center">
              <LoaderCircle
                className="size-7 animate-spin text-muted-foreground motion-reduce:animate-none"
                aria-hidden="true"
              />
              <p className="text-sm font-medium">Preparing your branches</p>
              <p className="text-sm text-muted-foreground">
                CoDev is loading the workspace branches and their current activity.
              </p>
            </div>
          </div>
        ) : showFullFailure ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8" role="alert">
            <div className="flex max-w-sm flex-col items-center gap-3 p-3 text-center">
              <CircleAlert className="size-7 text-destructive" aria-hidden="true" />
              <p className="text-sm font-medium">Branches could not be loaded</p>
              <p className="text-sm text-muted-foreground">
                {liveDataError ?? 'Live branch data is unavailable.'}
              </p>
              <button
                type="button"
                onClick={retry}
                className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Try again
              </button>
            </div>
          </div>
        ) : showFullDisconnected ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8" role="status">
            <div className="flex max-w-sm flex-col items-center gap-3 p-3 text-center">
              <WifiOff className="size-7 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">Waiting for the workspace connection</p>
              <p className="text-sm text-muted-foreground">
                Branches will appear when CoDev reconnects to this workspace.
              </p>
              <button
                type="button"
                onClick={retry}
                className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg border border-border/70 px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Reconnect
              </button>
            </div>
          </div>
        ) : showEmpty ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8" role="status">
            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
              <GitBranch className="size-7 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">No branch workspaces yet</p>
              <p className="text-sm text-muted-foreground">
                Start an agent or create a branch to see it here.
              </p>
            </div>
          </div>
        ) : (
          <ul className="scrollbar-sleek grid min-h-0 flex-1 auto-rows-max grid-cols-1 content-start gap-3 overflow-y-auto p-3">
            {rows.map((row) => (
              <CodevBranchCard
                key={row.id}
                row={row}
                active={row.id === activeWorktreeId}
                opening={row.id === openingId}
                now={now}
                onOpen={(nextRow) => void openBranch(nextRow)}
              />
            ))}
          </ul>
        )}
        {rosterError && !liveDataError ? (
          <p className="shrink-0 px-3 pb-3 text-[11px] text-muted-foreground" role="status">
            Ownership details are temporarily unavailable; showing the latest branch data.
          </p>
        ) : null}
      </div>
    </section>
  )
}
