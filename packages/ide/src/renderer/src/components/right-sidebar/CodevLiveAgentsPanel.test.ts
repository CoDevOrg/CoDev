import { describe, expect, it } from 'vitest'
import {
  localAgentTabsWithoutStatus,
  resolveLocalStatusAgent,
  resolveLocalTabAgent
} from './codev-local-agent-tabs'

const LEAF = '11111111-1111-4111-8111-111111111111'

describe('localAgentTabsWithoutStatus', () => {
  it('counts a launched chat tab before its provider emits status', () => {
    const result = localAgentTabsWithoutStatus(
      {
        w1: [{ id: 'tab-1', worktreeId: 'w1', launchAgent: 'codex', viewMode: 'chat' }]
      },
      {}
    )

    expect(result).toEqual([
      {
        worktreeId: 'w1',
        tab: { id: 'tab-1', worktreeId: 'w1', launchAgent: 'codex', viewMode: 'chat' }
      }
    ])
  })

  it('does not duplicate a tab that already has a hook status row', () => {
    const result = localAgentTabsWithoutStatus(
      {
        w1: [{ id: 'tab-1', worktreeId: 'w1', launchAgent: 'codex' }]
      },
      { [`tab-1:${LEAF}`]: { agentType: 'codex' } }
    )

    expect(result).toEqual([])
  })

  it('recognizes a restored chat view when launch metadata was not mirrored', () => {
    const result = localAgentTabsWithoutStatus(
      { w1: [{ id: 'tab-1', worktreeId: 'w1', viewMode: 'chat' }] },
      {}
    )

    expect(result).toHaveLength(1)
  })
})

describe('resolveLocalTabAgent', () => {
  it('preserves Claude identity from a restored tab label when launch metadata is missing', () => {
    expect(
      resolveLocalTabAgent({ id: 'tab-1', title: 'claude-40d28bf7', viewMode: 'chat' }, 'codex')
    ).toBe('claude')
  })

  it('prefers explicit launch metadata over a stale-looking title', () => {
    expect(
      resolveLocalTabAgent(
        { id: 'tab-1', launchAgent: 'codex', title: 'claude-40d28bf7', viewMode: 'chat' },
        'claude'
      )
    ).toBe('codex')
  })
})

describe('resolveLocalStatusAgent', () => {
  it('recovers Claude from a generated identity left on a stale Codex status row', () => {
    expect(resolveLocalStatusAgent('codex', 'claude-40d28bf7', undefined)).toBe('claude')
  })

  it('does not let ordinary task text override an explicit Codex provider', () => {
    expect(resolveLocalStatusAgent('codex', 'Claude integration', undefined)).toBe('codex')
  })
})
