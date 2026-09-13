// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearCodevAgentLaunching,
  isCodevAgentLaunching,
  markCodevAgentLaunching,
  resetCodevAgentLaunchStateForTest,
  subscribeCodevAgentLaunching
} from './codev-agent-launch-state'

afterEach(() => {
  resetCodevAgentLaunchStateForTest()
})

describe('codev agent launch state', () => {
  /** The bug: "no agent tab" was read as "an agent is coming", so stopping one
   *  still reported "Still starting your assistant". */
  it('reports nothing in flight for a worktree whose agent was stopped', () => {
    markCodevAgentLaunching('wt-1')
    clearCodevAgentLaunching('wt-1')
    expect(isCodevAgentLaunching('wt-1')).toBe(false)
  })

  it('never reports a worktree that was never launched', () => {
    expect(isCodevAgentLaunching('wt-unknown')).toBe(false)
  })

  it('tracks worktrees independently', () => {
    markCodevAgentLaunching('wt-1')
    expect(isCodevAgentLaunching('wt-1')).toBe(true)
    expect(isCodevAgentLaunching('wt-2')).toBe(false)
  })

  it('notifies subscribers on both edges so the cover re-renders', () => {
    const listener = vi.fn()
    subscribeCodevAgentLaunching(listener)

    markCodevAgentLaunching('wt-1')
    expect(listener).toHaveBeenCalledTimes(1)

    clearCodevAgentLaunching('wt-1')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not notify on a repeated mark or an unknown clear', () => {
    const listener = vi.fn()
    subscribeCodevAgentLaunching(listener)

    markCodevAgentLaunching('wt-1')
    markCodevAgentLaunching('wt-1')
    clearCodevAgentLaunching('wt-other')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn()
    subscribeCodevAgentLaunching(listener)()
    markCodevAgentLaunching('wt-1')
    expect(listener).not.toHaveBeenCalled()
  })
})
