import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  attachMissionControlHolds,
  CodevMissionControlView,
  distinctLocalAgentEntries,
  mergeMissionControlAgents,
  missionControlContestNotice,
  missionControlOverlapNotice,
  missionControlPhaseFromStatus,
  sortMissionControlAgents,
  type MissionControlAgent,
  type MissionControlCoordination
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
    branch: null,
    holds: [],
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

function coordination(
  overrides: Partial<MissionControlCoordination> = {}
): MissionControlCoordination {
  return { claims: [], contests: [], overlaps: [], ...overrides }
}

function holder(agentLabel: string, ...paths: string[]) {
  return { sessionId: agentLabel, agentLabel, paths }
}

describe('attachMissionControlHolds', () => {
  it('matches a managed agent on its session id', () => {
    const [row] = attachMissionControlHolds(
      [agent({ sessionId: 's1', worktreeId: 'w1', branch: null })],
      coordination({
        claims: [
          {
            id: 'c1',
            sessionId: 's1',
            worktreeId: null,
            branch: null,
            agentLabel: 'Wire the billing webhook',
            path: 'app/api/webhooks/route.ts',
            status: 'active'
          }
        ]
      })
    )
    expect(row?.holds).toEqual([
      { claimId: 'c1', path: 'app/api/webhooks/route.ts', status: 'active' }
    ])
  })

  /**
   * A chat-tab agent has no CoDev session id in this panel, so its branch is
   * the only identity it shares with the `cli` session the coordination MCP
   * created for it.
   */
  it('matches a chat-tab agent on its branch', () => {
    const [row] = attachMissionControlHolds(
      [agent({ origin: 'you', sessionId: null, worktreeId: null, branch: 'codev/fix-auth-1a2b' })],
      coordination({
        claims: [
          {
            id: 'c9',
            sessionId: 'cli-1',
            worktreeId: 'codev-worktree-1',
            branch: 'codev/fix-auth-1a2b',
            agentLabel: 'claude · codev/fix-auth-1a2b',
            path: 'apps/web/lib/auth.ts',
            status: 'contested'
          }
        ]
      })
    )
    expect(row?.holds).toEqual([
      { claimId: 'c9', path: 'apps/web/lib/auth.ts', status: 'contested' }
    ])
  })

  it('never hands an agent a claim it cannot be matched to', () => {
    const [row] = attachMissionControlHolds(
      [agent({ sessionId: 's1', worktreeId: 'w1', branch: 'mine' })],
      coordination({
        claims: [
          {
            id: 'c2',
            sessionId: 'someone-else',
            worktreeId: 'w2',
            branch: 'theirs',
            agentLabel: 'Another agent',
            path: 'packages/db/src/schema.ts',
            status: 'active'
          }
        ]
      })
    )
    expect(row?.holds).toEqual([])
  })
})

describe('missionControlContestNotice', () => {
  it('says nothing when no path is held twice', () => {
    expect(missionControlContestNotice(coordination())).toBeNull()
  })

  it('names the two agents and the path they are both on', () => {
    const notice = missionControlContestNotice(
      coordination({
        contests: [
          {
            paths: ['apps/web/lib/auth.ts'],
            holders: [
              holder('claude · codev/alice', 'apps/web/lib/auth.ts'),
              holder('codex · codev/bob', 'apps/web/lib/auth.ts')
            ]
          }
        ]
      })
    )
    expect(notice).toContain('claude · codev/alice and codex · codev/bob')
    expect(notice).toContain('apps/web/lib/auth.ts')
  })

  /**
   * A claim can be a `dir/**` glob, so the two sides of a collision are often
   * different strings. Naming only one of them would describe a collision the
   * reader cannot locate.
   */
  it('names both patterns when a glob collides with a file inside it', () => {
    const notice = missionControlContestNotice(
      coordination({
        contests: [
          {
            paths: ['apps/web/**', 'apps/web/lib/auth.ts'],
            holders: [
              holder('alice-agent', 'apps/web/**'),
              holder('bob-agent', 'apps/web/lib/auth.ts')
            ]
          }
        ]
      })
    )
    expect(notice).toContain('alice-agent holds apps/web/**')
    expect(notice).toContain('bob-agent holds apps/web/lib/auth.ts')
    expect(notice).not.toContain('both hold')
  })

  it('does not say "both" when three agents hold the path', () => {
    const notice = missionControlContestNotice(
      coordination({
        contests: [
          {
            paths: ['a.ts'],
            holders: [holder('one', 'a.ts'), holder('two', 'a.ts'), holder('three', 'a.ts')]
          }
        ]
      })
    )
    expect(notice).toContain('3 agents')
    expect(notice).not.toContain('both')
  })
})

describe('missionControlOverlapNotice', () => {
  it('says nothing when the brain has flagged no overlap', () => {
    expect(missionControlOverlapNotice(coordination())).toBeNull()
  })

  /**
   * The overlap warning fires before anyone claims a file. It used to be
   * fetched every poll and thrown away, so a converging pair produced no
   * banner, no chip, and no sign at all.
   */
  it('surfaces a converging pair the brain has flagged', () => {
    const notice = missionControlOverlapNotice(
      coordination({
        overlaps: [
          {
            id: 'o1',
            sessionIds: ['a', 'b'],
            agentLabels: ['alice-agent', 'bob-agent'],
            kind: 'same_files',
            score: 82,
            rationale: 'Both briefs name apps/web/lib/auth.ts.'
          }
        ]
      })
    )
    expect(notice).toContain('alice-agent and bob-agent')
    expect(notice).toContain('Both briefs name apps/web/lib/auth.ts.')
  })
})

describe('CodevMissionControlView — collisions are read, not inferred', () => {
  const noop = (): void => undefined

  /**
   * The panel used to derive "blocked on a file claim" from a regex over an
   * agent's status text and then describe the claim mechanism to the user on
   * that basis. A blocked agent with no claim behind it now gets the plain
   * truth: it is waiting on a person.
   */
  it('does not describe a file claim for an agent that holds nothing', () => {
    const html = renderToStaticMarkup(
      <CodevMissionControlView
        agents={[agent({ phase: 'blocked', holds: [] })]}
        coordination={coordination()}
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
    expect(html).not.toContain('file claim')
    expect(html).toContain('waiting on you')
  })

  it('reports a real contest from the claim rows', () => {
    const html = renderToStaticMarkup(
      <CodevMissionControlView
        agents={[
          agent({
            holds: [{ claimId: 'c1', path: 'apps/web/lib/auth.ts', status: 'contested' }]
          })
        ]}
        coordination={coordination({
          contests: [
            {
              paths: ['apps/web/lib/auth.ts'],
              holders: [
                holder('Alice agent', 'apps/web/lib/auth.ts'),
                holder('Bob agent', 'apps/web/lib/auth.ts')
              ]
            }
          ]
        })}
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
    expect(html).toContain('Alice agent and Bob agent')
    expect(html).toContain('codev-mc-hold is-contested')
    expect(html).toContain('apps/web/lib/auth.ts')
  })

  it('renders no holds list for an agent that has claimed nothing', () => {
    const html = renderToStaticMarkup(
      <CodevMissionControlView
        agents={[agent({ holds: [] })]}
        coordination={coordination()}
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
    expect(html).not.toContain('codev-mc-holds')
  })
})
