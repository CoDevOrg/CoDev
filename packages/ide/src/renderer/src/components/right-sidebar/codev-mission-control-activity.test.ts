import { describe, expect, it } from 'vitest'

import {
  isAgentWorking,
  summarizeAgentActivity,
  type MissionControlPhase
} from './codev-mission-control-model'

const agent = (phase: MissionControlPhase): { phase: MissionControlPhase } => ({ phase })

describe('isAgentWorking', () => {
  it('counts every phase a person is waiting on', () => {
    for (const phase of ['planning', 'working', 'testing', 'reviewing', 'blocked'] as const) {
      expect(isAgentWorking(agent(phase))).toBe(true)
    }
  })

  /**
   * The bug this rule exists for: Mission Control lists an open chat tab with
   * no turn in flight, and the workspace top bar called it "1 agent live"
   * beside this panel's own "Idle" label.
   */
  it('does not count an agent that is only sitting there', () => {
    expect(isAgentWorking(agent('done'))).toBe(false)
    expect(isAgentWorking(agent('waiting'))).toBe(false)
  })
})

describe('summarizeAgentActivity', () => {
  it('splits a merged list into working, idle and total', () => {
    expect(
      summarizeAgentActivity([agent('working'), agent('done'), agent('waiting'), agent('testing')])
    ).toEqual({ active: 2, idle: 2, total: 4 })
  })

  it('reports an empty workspace as nothing rather than unknown', () => {
    expect(summarizeAgentActivity([])).toEqual({ active: 0, idle: 0, total: 0 })
  })

  it('reports a single idle chat tab as idle, never as active', () => {
    expect(summarizeAgentActivity([agent('done')])).toEqual({
      active: 0,
      idle: 1,
      total: 1
    })
  })
})
