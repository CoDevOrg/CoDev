import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevWorktreeSlotMeta, publishCodevWorkboard } from './codev-workboard-store'

describe('CodevWorktreeSlotMeta', () => {
  it('renders CoDev slot fields on a managed-proposal worktree card', () => {
    publishCodevWorkboard({
      capacity: { maxActiveSessions: 3, activeSessions: 1, availableSlots: 2 },
      slots: [
        {
          slot: 1,
          occupied: true,
          sessionId: 'session-1',
          worktreeId: 'c1f9fe13-6881-44a6-adbd-96bc5a946afa',
          assignment: 'Repository map',
          owner: 'Alex Morgan',
          provider: 'openai',
          status: 'Active',
          worktree: 'agent-managed-proposal-one',
          currentTask: 'Map the repository layout.',
          elapsed: '00:18'
        }
      ]
    })
    const html = renderToStaticMarkup(
      <CodevWorktreeSlotMeta
        worktree={{
          path: '/tmp/repo',
          comment: 'codev-proposal:c1f9fe13-6881-44a6-adbd-96bc5a946afa'
        }}
      />
    )
    expect(html).toContain('Agent slot 1 details')
    expect(html).toContain('Repository map')
    expect(html).toContain('Alex Morgan')
    expect(html).toContain('00:18')
    publishCodevWorkboard(null)
  })
})
