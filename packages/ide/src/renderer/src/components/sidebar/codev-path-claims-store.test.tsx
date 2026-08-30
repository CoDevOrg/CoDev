import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CodevExplorerPathClaimBadge,
  CodevWorktreePathClaims,
  publishCodevPathClaims
} from './codev-path-claims-store'

describe('CodevExplorerPathClaimBadge', () => {
  it('marks a contested README.md row in Explorer', () => {
    publishCodevPathClaims({
      groups: [
        {
          path: 'README.md',
          contested: true,
          warningTitle: 'Contested overlap · no silent overwrite',
          warningDetail: 'Reassign or cancel before either agent writes.',
          keepClaimId: 'claim-1',
          overlappingClaimId: 'claim-2',
          reassignSlot: 2,
          reassignClaimId: 'claim-2',
          claims: [
            {
              id: 'claim-1',
              sessionId: 's1',
              slot: 1,
              assignment: 'Repository map',
              owner: 'Alex',
              worktreeId: 'w1',
              worktree: 'one',
              path: 'README.md',
              intent: 'write',
              revision: 'HEAD',
              status: 'contested',
              displayStatus: 'Contested',
              expiresAt: '2026-08-15T08:15:00.000Z'
            }
          ]
        }
      ]
    })
    const html = renderToStaticMarkup(<CodevExplorerPathClaimBadge relativePath="README.md" />)
    expect(html).toContain('README.md Contested')
    expect(html).toContain('Contested')
    publishCodevPathClaims(null)
  })
})

describe('CodevWorktreePathClaims', () => {
  it('shows the contested warning and reassign control on a worktree card', () => {
    publishCodevPathClaims({
      notice: null,
      groups: [
        {
          path: 'README.md',
          contested: true,
          warningTitle: 'Contested overlap · no silent overwrite',
          warningDetail: null,
          keepClaimId: 'claim-1',
          overlappingClaimId: 'claim-2',
          reassignSlot: 2,
          reassignClaimId: 'claim-2',
          claims: [
            {
              id: 'claim-2',
              sessionId: 's2',
              slot: 2,
              assignment: 'Documentation sync',
              owner: 'Jordan',
              worktreeId: 'c1f9fe13-6881-44a6-adbd-96bc5a946afa',
              worktree: 'two',
              path: 'README.md',
              intent: 'write',
              revision: 'HEAD',
              status: 'contested',
              displayStatus: 'Contested',
              expiresAt: '2026-08-15T08:15:00.000Z'
            }
          ]
        }
      ],
      claims: [
        {
          id: 'claim-2',
          sessionId: 's2',
          slot: 2,
          assignment: 'Documentation sync',
          owner: 'Jordan',
          worktreeId: 'c1f9fe13-6881-44a6-adbd-96bc5a946afa',
          worktree: 'two',
          path: 'README.md',
          intent: 'write',
          revision: 'HEAD',
          status: 'contested',
          displayStatus: 'Contested',
          expiresAt: '2026-08-15T08:15:00.000Z'
        }
      ]
    })
    const html = renderToStaticMarkup(
      <CodevWorktreePathClaims
        worktree={{
          path: '/tmp/repo',
          comment: 'codev-proposal:c1f9fe13-6881-44a6-adbd-96bc5a946afa'
        }}
      />
    )
    expect(html).toContain('Contested overlap · no silent overwrite')
    expect(html).toContain('README.md · Contested')
    expect(html).toContain('Reassign to slot 2')
    expect(html).toContain('Cancel overlapping claim')
    publishCodevPathClaims(null)
  })
})
