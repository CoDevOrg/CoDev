import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevReviewCheckpointViewPanel } from './CodevReviewCheckpointView'
import type { CodevReviewCheckpoint } from './codev-review-checkpoint-snapshot'
import { selectCodevReviewCheckpoint } from './codev-review-checkpoint-selection'

const prepared: CodevReviewCheckpoint = {
  sessionId: 's1',
  slot: 2,
  assignment: 'Documentation sync',
  worktreeId: 'w2',
  worktree: 'agent-managed-proposal-two',
  worktreeStatus: 'Frozen',
  prepared: true,
  baseRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  headRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  diffDigest: 'sha256:3f7a2c8d9b1e4f605a7c9d2e8b6f104c3d5e7a9b1c2d4f608e9a7b5c3d1f2e4a',
  summary: '3 paths changed · 2 text files · 1 binary file',
  additions: 14,
  deletions: 3,
  paths: [
    { path: 'README.md', kind: 'modified', detail: '+8 −2 lines' },
    { path: 'src/hello.ts', kind: 'modified', detail: '+6 −1 line' },
    { path: 'assets/logo.png', kind: 'binary', detail: 'Binary file · content omitted' }
  ]
}

describe('CodevReviewCheckpointViewPanel', () => {
  it('renders Source Control checkpoint metadata after mark review-ready', () => {
    const html = renderToStaticMarkup(
      <CodevReviewCheckpointViewPanel
        surface="source-control"
        connected
        snapshot={{ checkpoints: [prepared] }}
        checkpoint={prepared}
        busy=""
        canReview
        diffOpen={false}
        onRefresh={() => undefined}
        onPrepare={() => undefined}
        onOpenDiff={() => undefined}
      />
    )
    expect(html).toContain('Review ready · immutable checkpoint')
    expect(html).toContain('Further writes must create a new checkpoint.')
    expect(html).toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(html).toContain('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(html).toContain(
      'sha256:3f7a2c8d9b1e4f605a7c9d2e8b6f104c3d5e7a9b1c2d4f608e9a7b5c3d1f2e4a'
    )
    expect(html).toContain('Checkpoint prepared')
    expect(html).toContain('Open diff review')
    expect(html).not.toContain('GIT binary patch')
  })

  it('renders Checks binary-safe diff paths after opening the review', () => {
    const html = renderToStaticMarkup(
      <CodevReviewCheckpointViewPanel
        surface="checks"
        connected
        snapshot={{ checkpoints: [prepared] }}
        checkpoint={prepared}
        busy=""
        canReview
        diffOpen
        onRefresh={() => undefined}
        onPrepare={() => undefined}
        onOpenDiff={() => undefined}
      />
    )
    expect(html).toContain('3 paths changed · 2 text files · 1 binary file')
    expect(html).toContain('+14 −3 lines')
    expect(html).toContain('README.md')
    expect(html).toContain('src/hello.ts')
    expect(html).toContain('assets/logo.png')
    expect(html).toContain('Binary file · content omitted')
    expect(html).toContain(
      'Binary content is not rendered as text; review remains safe for binary and generated files.'
    )
    expect(html).toContain('Diff review open')
    expect(html).not.toContain('zcmV-')
  })

  it('renders stale-review rejection after the integration head advances', () => {
    const html = renderToStaticMarkup(
      <CodevReviewCheckpointViewPanel
        surface="source-control"
        connected
        snapshot={{
          viewer: {
            id: 'u1',
            name: 'Jordan Lee',
            role: 'Maintainer',
            canReview: true,
            canMerge: true
          },
          checkpoints: [{ ...prepared, stale: true }],
          integrationHeadRevision: 'cccccccccccccccccccccccccccccccccccccccc',
          approval: { state: 'stale', blocked: true, mergeStarted: false }
        }}
        checkpoint={{ ...prepared, stale: true }}
        busy=""
        canReview
        canMerge
        diffOpen={false}
        onRefresh={() => undefined}
        onPrepare={() => undefined}
        onAdvance={() => undefined}
        onMerge={() => undefined}
        onOpenDiff={() => undefined}
      />
    )
    expect(html).toContain('Stale')
    expect(html).toContain('Stale checkpoint · approval blocked')
    expect(html).toContain('The integration worktree advanced from')
    expect(html).toContain('cccccccccccccccccccccccccccccccccccccccc')
    expect(html).toContain('Rebase and review again before approval.')
    expect(html).toContain('No merge action started.')
    expect(html).toContain('Approval blocked')
    expect(html).toContain('Prepare current checkpoint')
    expect(html).toContain('Integration head advanced')
  })

  it('renders exactly-once attributed integration and disables a second approval', () => {
    const html = renderToStaticMarkup(
      <CodevReviewCheckpointViewPanel
        surface="source-control"
        connected
        snapshot={{
          viewer: {
            id: 'u1',
            name: 'Jordan Lee',
            role: 'Maintainer',
            canReview: true,
            canMerge: true
          },
          checkpoints: [],
          integrationHeadRevision: 'dddddddddddddddddddddddddddddddddddddddd',
          approval: { state: 'integrated', blocked: false, mergeStarted: false },
          integration: {
            actor: 'Jordan Lee',
            role: 'Maintainer',
            event: 'agent.review_merged',
            baseRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            headRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            mergedHeadSha: 'dddddddddddddddddddddddddddddddddddddddd'
          }
        }}
        checkpoint={null}
        busy=""
        canReview
        canMerge
        diffOpen={false}
        onRefresh={() => undefined}
        onPrepare={() => undefined}
        onAdvance={() => undefined}
        onMerge={() => undefined}
        onOpenDiff={() => undefined}
      />
    )
    expect(html).toContain('Integrated exactly one current reviewed checkpoint')
    expect(html).toContain(
      'The integration head advanced to dddddddddddddddddddddddddddddddddddddddd'
    )
    expect(html).toContain('Jordan Lee · Maintainer')
    expect(html).toContain('agent.review_merged')
    expect(html).toContain(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa → bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )
    expect(html).toContain('Duplicate approval is disabled for this checkpoint.')
    expect(html).toContain('Checkpoint integrated')
  })
})

/**
 * The checkpoint a checkout's controls act on must be that checkout's own, or
 * one the member picked on purpose. The old selector fell back to the last
 * prepared checkpoint of whatever worktree had one, so Prepare and Approve in
 * one worktree's Source Control could act on another proposal.
 */
describe('selectCodevReviewCheckpoint', () => {
  const other: CodevReviewCheckpoint = {
    ...prepared,
    sessionId: 'other-session',
    slot: 1,
    worktreeId: 'other',
    worktree: 'agent-managed-proposal-one'
  }

  it("uses the active worktree's own checkpoint", () => {
    expect(selectCodevReviewCheckpoint([other, prepared], 'w2')).toEqual({
      source: 'worktree',
      checkpoint: prepared
    })
  })

  it('produces an empty state for a proposal worktree with no checkpoint, never another worktree’s', () => {
    expect(selectCodevReviewCheckpoint([other], 'selected')).toEqual({
      source: 'none',
      checkpoint: null,
      reason: 'no-checkpoint-for-worktree'
    })
  })

  it('does not substitute a prepared checkpoint when the checkout is not a proposal', () => {
    expect(selectCodevReviewCheckpoint([other, prepared], null)).toEqual({
      source: 'none',
      checkpoint: null,
      reason: 'not-a-proposal'
    })
    expect(selectCodevReviewCheckpoint([], null)).toEqual({
      source: 'none',
      checkpoint: null,
      reason: 'no-checkpoints'
    })
  })

  it('honours a deliberate choice, scoped to the checkout it was made in', () => {
    const choice = { worktreeId: null, sessionId: 'other-session' }
    expect(selectCodevReviewCheckpoint([other, prepared], null, choice)).toEqual({
      source: 'chosen',
      checkpoint: other
    })
    // Switching to a proposal worktree drops the pick made elsewhere.
    expect(selectCodevReviewCheckpoint([other, prepared], 'selected', choice).source).toBe('none')
    // The worktree's own checkpoint still wins over a stale pick.
    expect(
      selectCodevReviewCheckpoint([other, prepared], 'w2', {
        worktreeId: 'w2',
        sessionId: 'other-session'
      })
    ).toEqual({
      source: 'worktree',
      checkpoint: prepared
    })
  })

  it('offers a labelled picker instead of a silent fallback', () => {
    const html = renderToStaticMarkup(
      <CodevReviewCheckpointViewPanel
        surface="source-control"
        connected
        snapshot={{ checkpoints: [other, prepared] }}
        checkpoint={null}
        selection={{ source: 'none', checkpoint: null, reason: 'not-a-proposal' }}
        onChooseCheckpoint={() => undefined}
        busy=""
        canReview
        diffOpen={false}
        onRefresh={() => undefined}
        onPrepare={() => undefined}
        onOpenDiff={() => undefined}
      />
    )
    expect(html).toContain('This checkout is not an agent proposal.')
    expect(html).toContain('Proposal to review')
    expect(html).toContain('Choose a proposal…')
    expect(html).not.toContain('Review ready · immutable checkpoint')
  })

  it('says when the checkpoint on screen was chosen from another worktree', () => {
    const html = renderToStaticMarkup(
      <CodevReviewCheckpointViewPanel
        surface="source-control"
        connected
        snapshot={{ checkpoints: [other, prepared] }}
        checkpoint={other}
        selection={{ source: 'chosen', checkpoint: other }}
        onChooseCheckpoint={() => undefined}
        busy=""
        canReview
        diffOpen={false}
        onRefresh={() => undefined}
        onPrepare={() => undefined}
        onOpenDiff={() => undefined}
      />
    )
    expect(html).toContain('from worktree agent-managed-proposal-one, chosen by you')
    expect(html).toContain('Proposal to review')
  })
})
