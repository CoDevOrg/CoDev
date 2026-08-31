import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CodevMissionControlView,
  distinctLocalAgentEntries,
  mergeMissionControlAgents,
  missionControlPhaseFromStatus,
  sortMissionControlAgents,
  type MissionControlAgent
} from './CodevMissionControlView'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'

function agent(overrides: Partial<MissionControlAgent>): MissionControlAgent {
  return {
    key: 'managed:s1',
    origin: 'managed',
    sessionId: 's1',
    worktreeId: 'w1',
    ownerName: 'Alex Morgan',
    ownerHue: 200,
    providerLabel: 'Claude',
    model: 'sonnet',
    phase: 'working',
    title: 'Wire the billing webhook',
    activity: 'Editing app/api/webhooks/route.ts',
    startedAt: null,
    serverElapsed: '01:20',
    canSteer: true,
    ...overrides
  }
}

describe('missionControlPhaseFromStatus', () => {
  it('maps server status strings onto phases', () => {
    expect(missionControlPhaseFromStatus('Active')).toBe('working')
    expect(missionControlPhaseFromStatus('Awaiting review')).toBe('reviewing')
    expect(missionControlPhaseFromStatus('Blocked on claim')).toBe('blocked')
    expect(missionControlPhaseFromStatus('Running tests')).toBe('testing')
    expect(missionControlPhaseFromStatus('Merged')).toBe('done')
    expect(missionControlPhaseFromStatus('Queued')).toBe('waiting')
  })
})

describe('sortMissionControlAgents', () => {
  it('surfaces whatever needs a human first', () => {
    const order = sortMissionControlAgents([
      agent({ key: 'a', phase: 'done' }),
      agent({ key: 'b', phase: 'blocked' }),
      agent({ key: 'c', phase: 'working' })
    ]).map((entry) => entry.key)
    expect(order).toEqual(['b', 'c', 'a'])
  })
})

describe('distinctLocalAgentEntries', () => {
  it('keeps two agents in one worktree — a tab is an agent, provider does not matter', () => {
    const kept = distinctLocalAgentEntries([
      [`tab-one:${LEAF_A}`, { worktreeId: 'w1' }],
      [`tab-two:${LEAF_B}`, { worktreeId: 'w1' }]
    ]).map(([paneKey]) => paneKey)
    expect(kept).toEqual([`tab-one:${LEAF_A}`, `tab-two:${LEAF_B}`])
  })

  it('collapses a superseded row left behind by a reload of the same tab', () => {
    // entries arrive newest-first; the fresh leaf for tab-one wins.
    const kept = distinctLocalAgentEntries([
      [`tab-one:${LEAF_B}`, { worktreeId: 'w1' }],
      [`tab-one:${LEAF_A}`, { worktreeId: 'w1' }]
    ]).map(([paneKey]) => paneKey)
    expect(kept).toEqual([`tab-one:${LEAF_B}`])
  })

  it('falls back to worktree, then paneKey, for rows with no derivable tab', () => {
    const kept = distinctLocalAgentEntries([
      ['not-a-pane-key', { worktreeId: 'w1' }],
      ['also-not', { worktreeId: 'w1' }],
      ['anon', {}]
    ]).map(([paneKey]) => paneKey)
    expect(kept).toEqual(['not-a-pane-key', 'anon'])
  })
})

describe('mergeMissionControlAgents', () => {
  it('drops a lone local entry that a managed session already covers for the same worktree', () => {
    const merged = mergeMissionControlAgents(
      [agent({ key: 'managed:s1', worktreeId: 'w1' })],
      [agent({ key: 'local:p1', origin: 'you', sessionId: null, worktreeId: 'w1' })]
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]!.key).toBe('managed:s1')
  })

  it('keeps every local agent when several share a worktree a managed session also covers', () => {
    const merged = mergeMissionControlAgents(
      [agent({ key: 'managed:s1', worktreeId: 'w1' })],
      [
        agent({ key: 'local:p1', origin: 'you', sessionId: null, worktreeId: 'w1' }),
        agent({ key: 'local:p2', origin: 'you', sessionId: null, worktreeId: 'w1' })
      ]
    )
    expect(merged.map((entry) => entry.key).sort()).toEqual(['local:p1', 'local:p2', 'managed:s1'])
  })

  it('keeps a local agent that has no managed twin', () => {
    const merged = mergeMissionControlAgents(
      [agent({ key: 'managed:s1', worktreeId: 'w1' })],
      [agent({ key: 'local:p9', origin: 'you', sessionId: null, worktreeId: 'w9' })]
    )
    expect(merged.map((entry) => entry.key).sort()).toEqual(['local:p9', 'managed:s1'])
  })
})

describe('CodevMissionControlView', () => {
  const noop = (): void => undefined

  it('renders a card per agent with owner, provider and activity', () => {
    const html = renderToStaticMarkup(
      <CodevMissionControlView
        agents={[
          agent({ key: 'managed:s1', ownerName: 'Alex Morgan', phase: 'working' }),
          agent({
            key: 'local:p1',
            origin: 'you',
            sessionId: null,
            worktreeId: 'w2',
            ownerName: 'You',
            providerLabel: 'Codex',
            title: 'Draft the release notes',
            activity: 'Reading git log',
            phase: 'planning'
          })
        ]}
        now={Date.now()}
        openKey={null}
        steerBusy={false}
        onOpen={noop}
        onClose={noop}
        onStepIn={noop}
        onSteer={noop}
        onPause={noop}
      />
    )
    expect(html).toContain('Mission Control')
    expect(html).toContain('Alex Morgan')
    expect(html).toContain('Wire the billing webhook')
    expect(html).toContain('Editing app/api/webhooks/route.ts')
    expect(html).toContain('Draft the release notes')
    expect(html).toContain('your chat tab')
    expect(html).toContain('2 people steering')
  })

  it('opens the steer drawer for a managed agent', () => {
    const html = renderToStaticMarkup(
      <CodevMissionControlView
        agents={[agent({ key: 'managed:s1', canSteer: true })]}
        now={Date.now()}
        openKey="managed:s1"
        steerBusy={false}
        onOpen={noop}
        onClose={noop}
        onStepIn={noop}
        onSteer={noop}
        onPause={noop}
      />
    )
    expect(html).toContain('codev-mc-drawer')
    expect(html).toContain('Add a test for that case')
    expect(html).toContain('co-steer turn')
  })

  it('shows the empty state when nothing is running', () => {
    const html = renderToStaticMarkup(
      <CodevMissionControlView
        agents={[]}
        now={Date.now()}
        openKey={null}
        steerBusy={false}
        onOpen={noop}
        onClose={noop}
        onStepIn={noop}
        onSteer={noop}
        onPause={noop}
      />
    )
    expect(html).toContain('No agents are running yet')
  })
})
