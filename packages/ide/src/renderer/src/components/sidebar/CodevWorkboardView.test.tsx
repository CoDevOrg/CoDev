import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevWorkboardViewPanel, type CodevWorkboardSlot } from './CodevWorkboardView'

const slots: CodevWorkboardSlot[] = [
  {
    slot: 1,
    occupied: true,
    sessionId: 's1',
    worktreeId: 'w1',
    assignment: 'Repository map',
    owner: 'Alex Morgan',
    provider: 'openai',
    status: 'Active',
    worktree: 'agent-managed-proposal-one',
    currentTask: 'Map the repository layout.',
    elapsed: '00:18'
  },
  {
    slot: 2,
    occupied: true,
    sessionId: 's2',
    worktreeId: 'w2',
    assignment: 'Presence replay',
    owner: 'Jordan Lee',
    provider: 'anthropic',
    status: 'Active',
    worktree: 'agent-managed-proposal-two',
    currentTask: 'Replay presence.',
    elapsed: '01:42'
  },
  {
    slot: 3,
    occupied: true,
    sessionId: 's3',
    worktreeId: 'w3',
    assignment: 'Session recovery',
    owner: 'Casey Rivera',
    provider: 'openai',
    status: 'Active',
    worktree: 'agent-managed-proposal-three',
    currentTask: 'Recover the session.',
    elapsed: '03:07'
  }
]

describe('CodevWorkboardViewPanel', () => {
  it('renders three occupied slots and the fourth-session rejection', () => {
    const html = renderToStaticMarkup(
      <CodevWorkboardViewPanel
        connected
        capacity={{ maxActiveSessions: 3, activeSessions: 3, availableSlots: 0 }}
        slots={slots}
        rejection={{
          status: 409,
          title: 'Server rejected the fourth session · HTTP 409',
          message:
            'All three agent slots are in use. Stop or wait for an active session to finish before starting another.'
        }}
        busy=""
        canCoSteer
        onRefresh={() => undefined}
        onStart={() => undefined}
      />
    )
    expect(html).toContain('Agent slot 1')
    expect(html).toContain('Repository map')
    expect(html).toContain('Alex Morgan')
    expect(html).toContain('openai')
    expect(html).toContain('00:18')
    expect(html).toContain('Start fourth session')
    expect(html).toContain('Server rejected the fourth session · HTTP 409')
    expect(html).toContain('All three agent slots are in use')
  })
})
