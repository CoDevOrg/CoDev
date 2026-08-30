import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevPathClaimsViewPanel, type CodevPathClaimGroup } from './CodevPathClaimsView'

const contested: CodevPathClaimGroup = {
  path: 'README.md',
  contested: true,
  warningTitle: 'Contested overlap · no silent overwrite',
  warningDetail:
    'Agent slot 2 requested README.md, which is already claimed by Agent slot 1. Reassign or cancel before either agent writes.',
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
      owner: 'Alex Morgan',
      worktreeId: 'w1',
      worktree: 'one',
      path: 'README.md',
      intent: 'Prepare an exact write claim',
      revision: 'HEAD',
      status: 'contested',
      displayStatus: 'Contested',
      expiresAt: '2026-08-15T08:15:00.000Z'
    },
    {
      id: 'claim-2',
      sessionId: 's2',
      slot: 2,
      assignment: 'Documentation sync',
      owner: 'Jordan Lee',
      worktreeId: 'w2',
      worktree: 'two',
      path: 'README.md',
      intent: 'Prepare an exact write claim',
      revision: 'HEAD',
      status: 'contested',
      displayStatus: 'Contested',
      expiresAt: '2026-08-15T08:15:00.000Z'
    }
  ]
}

describe('CodevPathClaimsViewPanel', () => {
  it('renders contested Explorer warnings and reassign/cancel controls', () => {
    const html = renderToStaticMarkup(
      <CodevPathClaimsViewPanel
        connected
        snapshot={{
          viewer: { id: 'u1', name: 'Jordan Lee', canCoSteer: true },
          slots: [
            { slot: 1, occupied: true, sessionId: 's1', assignment: 'Repository map' },
            { slot: 2, occupied: true, sessionId: 's2', assignment: 'Documentation sync' }
          ],
          groups: [contested],
          defaultPath: 'README.md',
          notice: null
        }}
        busy=""
        canCoSteer
        onRefresh={() => undefined}
        onClaim={() => undefined}
        onOverlap={() => undefined}
        onReassign={() => undefined}
        onCancel={() => undefined}
      />
    )
    expect(html).toContain('Contested overlap · no silent overwrite')
    expect(html).toContain('Reassign or cancel before either agent writes.')
    expect(html).toContain('README.md · Contested')
    expect(html).toContain('Reassign to slot 2')
    expect(html).toContain('Cancel overlapping claim')
  })

  it('shows the reassignment notice after the overlap is resolved', () => {
    const html = renderToStaticMarkup(
      <CodevPathClaimsViewPanel
        connected
        snapshot={{
          viewer: { id: 'u1', name: 'Jordan Lee', canCoSteer: true },
          groups: [
            {
              ...contested,
              contested: false,
              warningTitle: null,
              warningDetail: null,
              overlappingClaimId: null,
              reassignSlot: null,
              reassignClaimId: null,
              claims: [
                { ...contested.claims[0]!, status: 'released', displayStatus: 'Released' },
                { ...contested.claims[1]!, status: 'active', displayStatus: 'Active' }
              ]
            }
          ],
          notice: 'Claim reassigned to Agent slot 2'
        }}
        busy=""
        canCoSteer
        onRefresh={() => undefined}
        onClaim={() => undefined}
        onOverlap={() => undefined}
        onReassign={() => undefined}
        onCancel={() => undefined}
      />
    )
    expect(html).toContain('Claim reassigned to Agent slot 2')
    expect(html).toContain('README.md · Released')
    expect(html).toContain('README.md · Active')
    expect(html).not.toContain('Reassign to slot 2')
  })
})
