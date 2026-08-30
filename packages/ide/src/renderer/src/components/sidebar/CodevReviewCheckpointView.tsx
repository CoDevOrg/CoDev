import type { JSX } from 'react'
import { Button } from '@/components/ui/button'

export type CodevReviewDiffPath = {
  path: string
  kind: 'added' | 'deleted' | 'modified' | 'binary'
  detail: string
}

export type CodevReviewCheckpoint = {
  sessionId: string
  slot: 1 | 2 | 3 | null
  assignment: string
  worktreeId: string
  worktree: string
  worktreeStatus: string
  prepared: boolean
  stale?: boolean
  baseRevision: string | null
  headRevision: string | null
  diffDigest: string | null
  summary: string | null
  additions: number
  deletions: number
  paths: CodevReviewDiffPath[]
}

export type CodevReviewSlot = {
  slot: 1 | 2 | 3
  occupied: boolean
  sessionId: string | null
  worktreeId: string | null
  assignment: string
}

export type CodevReviewApproval = {
  state: 'current' | 'stale' | 'integrated'
  blocked: boolean
  mergeStarted: boolean
}

export type CodevReviewIntegration = {
  actor: string
  role: string
  event: 'agent.review_merged'
  baseRevision: string
  headRevision: string
  mergedHeadSha: string
}

export type CodevReviewSnapshot = {
  viewer?: {
    id: string
    name: string
    role?: string
    canReview: boolean
    canMerge?: boolean
  }
  slots?: CodevReviewSlot[]
  checkpoints?: CodevReviewCheckpoint[]
  integrationHeadRevision?: string | null
  approval?: CodevReviewApproval
  integration?: CodevReviewIntegration | null
}

export function selectCodevReviewCheckpoint(
  checkpoints: CodevReviewCheckpoint[],
  worktreeId: string | null
): CodevReviewCheckpoint | null {
  if (worktreeId) {
    const matched = checkpoints.find((checkpoint) => checkpoint.worktreeId === worktreeId)
    if (matched) return matched
  }
  const prepared = checkpoints.filter((checkpoint) => checkpoint.prepared)
  if (prepared.length > 0) {
    return prepared[prepared.length - 1] ?? null
  }
  return (
    checkpoints.find((checkpoint) => !checkpoint.prepared) ??
    checkpoints.find((checkpoint) => Boolean(checkpoint.sessionId)) ??
    null
  )
}

export function CodevReviewCheckpointViewPanel({
  surface,
  connected,
  snapshot,
  checkpoint,
  busy,
  canReview,
  canMerge = false,
  diffOpen,
  onRefresh,
  onPrepare,
  onAdvance,
  onMerge,
  onOpenDiff
}: {
  surface: 'source-control' | 'checks'
  connected: boolean
  snapshot: CodevReviewSnapshot | null
  checkpoint: CodevReviewCheckpoint | null
  busy: string
  canReview: boolean
  canMerge?: boolean
  diffOpen: boolean
  onRefresh: () => void
  onPrepare: () => void
  onAdvance?: () => void
  onMerge?: () => void
  onOpenDiff: () => void
}): JSX.Element {
  const headingId =
    surface === 'source-control' ? 'codev-review-checkpoint-heading' : 'codev-review-diff-heading'
  const integration = snapshot?.integration ?? null
  const approval = snapshot?.approval
  const integrationHead =
    snapshot?.integrationHeadRevision ?? (integration ? integration.mergedHeadSha : checkpoint?.baseRevision)
  const stale = Boolean(
    approval?.state === 'stale' ||
      checkpoint?.stale ||
      (checkpoint?.prepared &&
        checkpoint.baseRevision &&
        integrationHead &&
        checkpoint.baseRevision !== integrationHead)
  )
  const integrated = Boolean(integration || approval?.state === 'integrated')
  const prepared = Boolean(checkpoint?.prepared) || integrated
  const showDiff = diffOpen && Boolean(checkpoint?.prepared)
  const canPrepare =
    Boolean(checkpoint?.sessionId) &&
    canReview &&
    connected &&
    !integrated &&
    (!checkpoint?.prepared || stale)
  const canAdvance = Boolean(onAdvance) && canMerge && connected && prepared && !integrated && !stale
  const canApprove = Boolean(onMerge) && canMerge && connected && prepared && !integrated && !stale
  const approvalState = integrated ? 'Integrated' : stale ? 'Stale' : 'Current'

  return (
    <section
      className="shrink-0 border-b border-border px-3 py-2"
      aria-labelledby={headingId}
      data-codev-review-checkpoint={surface}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            CoDev · review checkpoint
          </p>
          <h2 id={headingId} className="text-sm font-semibold">
            {surface === 'source-control' ? 'Source Control checkpoint' : 'Checks diff review'}
          </h2>
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={busy === 'refresh'} onClick={onRefresh}>
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh review'}
        </Button>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        {connected
          ? checkpoint
            ? `Agent slot ${checkpoint.slot ?? '—'} · ${checkpoint.assignment}`
            : integrated
              ? 'The reviewed checkpoint is now the integration head.'
              : 'Select a managed proposal worktree to mark it review-ready.'
          : 'Waiting for the workspace-bound CoDev bridge.'}
      </p>
      {prepared && !integrated ? (
        <div className="mb-2 space-y-2" role="status" aria-label="Immutable review checkpoint">
          <div>
            <strong className="block text-xs">Review ready · immutable checkpoint</strong>
            <span className="text-[11px] text-muted-foreground">
              Further writes must create a new checkpoint.
            </span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
            <dt className="text-muted-foreground">Base revision</dt>
            <dd>
              <code>{checkpoint?.baseRevision}</code>
            </dd>
            <dt className="text-muted-foreground">Proposed revision</dt>
            <dd>
              <code>{checkpoint?.headRevision}</code>
            </dd>
            <dt className="text-muted-foreground">Diff digest</dt>
            <dd>
              <code>{checkpoint?.diffDigest}</code>
            </dd>
          </dl>
        </div>
      ) : integrated ? null : (
        <p className="mb-2 text-xs text-muted-foreground" role="status">
          No review checkpoint prepared yet.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {surface === 'source-control' ? (
          <Button type="button" size="sm" disabled={!canPrepare || Boolean(busy)} onClick={onPrepare}>
            {busy === 'prepare'
              ? 'Preparing…'
              : stale
                ? 'Prepare current checkpoint'
                : prepared
                  ? 'Checkpoint prepared'
                  : 'Mark review-ready'}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant={surface === 'source-control' ? 'ghost' : 'default'}
          disabled={!connected || !prepared || diffOpen || Boolean(busy) || integrated}
          onClick={onOpenDiff}
        >
          {diffOpen ? 'Diff review open' : 'Open diff review'}
        </Button>
      </div>
      {showDiff && checkpoint?.prepared ? (
        <div className="mt-2 space-y-2" role="region" aria-label="Review diff and affected paths">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="block text-[10px] uppercase text-muted-foreground">Diff summary</span>
              <strong>{checkpoint.summary ?? 'Diff summary unavailable until the sandbox is reachable.'}</strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase text-muted-foreground">Text delta</span>
              <strong>
                +{checkpoint.additions} −{checkpoint.deletions} lines
              </strong>
            </div>
          </div>
          <div>
            <span className="block text-[10px] uppercase text-muted-foreground">Affected paths</span>
            <ul className="mt-1 space-y-1 text-[11px]">
              {checkpoint.paths.map((entry) => (
                <li key={entry.path} className="flex items-center justify-between gap-2">
                  <code>{entry.path}</code>
                  <span>
                    {entry.kind} · {entry.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Binary content is not rendered as text; review remains safe for binary and generated files.
          </p>
        </div>
      ) : null}
      {prepared ? (
        <div className="mt-3 space-y-2" role="region" aria-label="Review approval gate">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="block text-[10px] uppercase text-muted-foreground">Integration head</span>
              <strong className="text-[11px]">
                <code>{integrationHead ?? 'unavailable'}</code>
              </strong>
            </div>
            <span className="text-[11px] font-medium">{approvalState}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Approval rechecks the integration head before any merge action starts.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!canAdvance || Boolean(busy)}
              onClick={onAdvance}
            >
              {busy === 'advance'
                ? 'Advancing…'
                : stale || integrated
                  ? 'Integration head advanced'
                  : 'Advance integration head'}
            </Button>
            <Button type="button" size="sm" disabled={!canApprove || Boolean(busy)} onClick={onMerge}>
              {busy === 'merge'
                ? 'Integrating…'
                : stale
                  ? 'Approval blocked'
                  : integrated
                    ? 'Checkpoint integrated'
                    : 'Approve checkpoint'}
            </Button>
          </div>
          {stale && !integrated ? (
            <div className="space-y-1 text-[11px]" role="alert">
              <strong className="block">Stale checkpoint · approval blocked</strong>
              <span className="block">
                The integration worktree advanced from {checkpoint?.baseRevision} to {integrationHead}.
              </span>
              <span className="block">Rebase and review again before approval.</span>
              <span className="block">No merge action started.</span>
            </div>
          ) : null}
          {integrated && integration ? (
            <div className="space-y-1 text-[11px]" role="status" aria-label="Integration and audit result">
              <strong className="block">Integrated exactly one current reviewed checkpoint</strong>
              <span className="block">The integration head advanced to {integration.mergedHeadSha}.</span>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                <dt className="text-muted-foreground">Merge actor</dt>
                <dd>
                  {integration.actor} · {integration.role}
                </dd>
                <dt className="text-muted-foreground">Audit event</dt>
                <dd>
                  <code>{integration.event}</code>
                </dd>
                <dt className="text-muted-foreground">Reviewed revision</dt>
                <dd>
                  {integration.baseRevision} → {integration.headRevision}
                </dd>
              </dl>
              <span className="block">Duplicate approval is disabled for this checkpoint.</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {snapshot?.viewer && !canReview ? (
        <p className="mt-2 text-[11px] text-muted-foreground">Reviewer capability is required to mark a checkpoint.</p>
      ) : null}
      {snapshot?.viewer && prepared && !canMerge ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Merge capability is required to approve or advance integration.
        </p>
      ) : null}
    </section>
  )
}
