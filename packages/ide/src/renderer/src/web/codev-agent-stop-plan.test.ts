import { describe, expect, it } from 'vitest'
import { planAgentStop, type StoppableAgent } from './codev-agent-stop-plan'

/** Every worktree in these fixtures is one CoDev made for an agent. */
const releasable = () => true
/** A workspace with no repository: agents run in the workspace's own root. */
const neverReleasable = () => false

const LEAF = '11111111-1111-4111-8111-111111111111'

function local(tabId: string, worktreeId: string | null): StoppableAgent {
  return { key: `local:${tabId}:${LEAF}`, origin: 'you', sessionId: null, worktreeId, tabId }
}

/** A chat that has no status row yet: keyed by tab, never by pane. */
function fallback(tabId: string, worktreeId: string | null): StoppableAgent {
  return { key: `local:tab:${tabId}`, origin: 'you', sessionId: null, worktreeId, tabId }
}

function managed(sessionId: string, worktreeId: string | null): StoppableAgent {
  return { key: `managed:${sessionId}`, origin: 'managed', sessionId, worktreeId, tabId: null }
}

describe('planAgentStop', () => {
  it('retires only the agent tab when siblings share the worktree', () => {
    const agents = [local('tab-a', 'wt-1'), local('tab-b', 'wt-1'), local('tab-c', 'wt-1')]

    expect(planAgentStop(agents[0]!.key, agents, releasable)).toEqual({
      kind: 'close-tab',
      tabId: 'tab-a',
      siblingCount: 2
    })
  })

  it('releases the worktree only for the last agent in it', () => {
    const agents = [local('tab-a', 'wt-1'), local('tab-b', 'wt-2')]

    expect(planAgentStop(agents[0]!.key, agents, releasable)).toEqual({
      kind: 'release-worktree',
      worktreeId: 'wt-1',
      survivorWorktreeIds: ['wt-2']
    })
  })

  it('counts a managed session in the same worktree as a sibling', () => {
    const agents = [local('tab-a', 'wt-1'), managed('session-1', 'wt-1')]

    expect(planAgentStop(agents[0]!.key, agents, releasable)).toEqual({
      kind: 'close-tab',
      tabId: 'tab-a',
      siblingCount: 1
    })
  })

  it('hands a managed agent to the host, which owns the same decision', () => {
    const agents = [managed('session-1', 'wt-1'), local('tab-a', 'wt-1')]

    expect(planAgentStop(agents[0]!.key, agents, releasable)).toEqual({
      kind: 'discard-session',
      sessionId: 'session-1'
    })
  })

  it("ends the last agent without releasing the workspace's own checkout", () => {
    const agents = [local('tab-a', 'workspace-root')]

    expect(planAgentStop(agents[0]!.key, agents, neverReleasable)).toEqual({
      kind: 'close-tab',
      tabId: 'tab-a',
      siblingCount: 0
    })
  })

  it('closes a local agent with a stable pane key even without a worktree', () => {
    const agents = [local('tab-a', null)]

    expect(planAgentStop(agents[0]!.key, agents, releasable)).toEqual({
      kind: 'close-tab',
      tabId: 'tab-a',
      siblingCount: 0
    })
    expect(planAgentStop('local:gone', agents, releasable)).toEqual({ kind: 'unsupported' })
  })

  it('closes a local agent from a legacy numeric pane key', () => {
    const agents: StoppableAgent[] = [
      { key: 'local:tab-a:0', origin: 'you', sessionId: null, worktreeId: null, tabId: 'tab-a' }
    ]

    expect(planAgentStop(agents[0]!.key, agents, releasable)).toEqual({
      kind: 'close-tab',
      tabId: 'tab-a',
      siblingCount: 0
    })
  })

  /**
   * A chat with no status row is keyed `local:tab:<tabId>`. Parsing that key
   * as a pane key made the tab `tab` — unsupported for an ordinary id, and a
   * confident close of a tab named "tab" for a UUID id — while the real agent
   * kept running. The row carries its tab; the planner reads it.
   */
  it('stops a fallback agent in a shared worktree by its own tab', () => {
    const agents = [fallback('tab-a', 'workspace-root'), local('tab-b', 'workspace-root')]

    expect(planAgentStop(agents[0]!.key, agents, neverReleasable)).toEqual({
      kind: 'close-tab',
      tabId: 'tab-a',
      siblingCount: 1
    })
  })

  it('stops a fallback agent whose tab id is a UUID by that UUID, not "tab"', () => {
    const agents = [fallback(LEAF, 'workspace-root')]

    expect(planAgentStop(agents[0]!.key, agents, neverReleasable)).toEqual({
      kind: 'close-tab',
      tabId: LEAF,
      siblingCount: 0
    })
  })

  it('releases the worktree for the last fallback agent in one CoDev made', () => {
    const agents = [fallback('tab-a', 'wt-1'), local('tab-b', 'wt-2')]

    expect(planAgentStop(agents[0]!.key, agents, releasable)).toEqual({
      kind: 'release-worktree',
      worktreeId: 'wt-1',
      survivorWorktreeIds: ['wt-2']
    })
  })

  it('refuses a local agent with no tab rather than guessing one', () => {
    const agents: StoppableAgent[] = [
      { key: 'local:not-a-pane-key', origin: 'you', sessionId: null, worktreeId: null, tabId: null }
    ]

    expect(planAgentStop(agents[0]!.key, agents, releasable)).toEqual({ kind: 'unsupported' })
  })
})
