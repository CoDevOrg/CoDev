import { describe, expect, it } from 'vitest'
import { planAgentStop, type StoppableAgent } from './codev-agent-stop-plan'

const LEAF = '11111111-1111-4111-8111-111111111111'

function local(tabId: string, worktreeId: string | null): StoppableAgent {
  return { key: `local:${tabId}:${LEAF}`, origin: 'you', sessionId: null, worktreeId }
}

function managed(sessionId: string, worktreeId: string | null): StoppableAgent {
  return { key: `managed:${sessionId}`, origin: 'managed', sessionId, worktreeId }
}

describe('planAgentStop', () => {
  it('retires only the agent tab when siblings share the worktree', () => {
    const agents = [local('tab-a', 'wt-1'), local('tab-b', 'wt-1'), local('tab-c', 'wt-1')]

    expect(planAgentStop(agents[0]!.key, agents)).toEqual({
      kind: 'close-tab',
      tabId: 'tab-a',
      siblingCount: 2
    })
  })

  it('releases the worktree only for the last agent in it', () => {
    const agents = [local('tab-a', 'wt-1'), local('tab-b', 'wt-2')]

    expect(planAgentStop(agents[0]!.key, agents)).toEqual({
      kind: 'release-worktree',
      worktreeId: 'wt-1',
      survivorWorktreeIds: ['wt-2']
    })
  })

  it('counts a managed session in the same worktree as a sibling', () => {
    const agents = [local('tab-a', 'wt-1'), managed('session-1', 'wt-1')]

    expect(planAgentStop(agents[0]!.key, agents)).toEqual({
      kind: 'close-tab',
      tabId: 'tab-a',
      siblingCount: 1
    })
  })

  it('hands a managed agent to the host, which owns the same decision', () => {
    const agents = [managed('session-1', 'wt-1'), local('tab-a', 'wt-1')]

    expect(planAgentStop(agents[0]!.key, agents)).toEqual({
      kind: 'discard-session',
      sessionId: 'session-1'
    })
  })

  it('cannot stop an agent with no worktree and no session', () => {
    const agents = [local('tab-a', null)]

    expect(planAgentStop(agents[0]!.key, agents)).toEqual({ kind: 'unsupported' })
    expect(planAgentStop('local:gone', agents)).toEqual({ kind: 'unsupported' })
  })
})
