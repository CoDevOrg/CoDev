import { describe, expect, it } from 'vitest'
import {
  localAgentTabsWithoutStatus,
  resolveLocalStatusAgent,
  resolveLocalTabAgent,
  tabIdFromPaneKey
} from './codev-local-agent-tabs'

const LEAF = '11111111-1111-4111-8111-111111111111'

describe('tabIdFromPaneKey', () => {
  it('resolves both the stable and the legacy pane-key forms to their tab', () => {
    expect(tabIdFromPaneKey(`tab-1:${LEAF}`)).toBe('tab-1')
    expect(tabIdFromPaneKey('tab-1:0')).toBe('tab-1')
    expect(tabIdFromPaneKey(`${LEAF}:${LEAF}`)).toBe(LEAF)
  })

  it('returns null for anything that is not a pane key', () => {
    expect(tabIdFromPaneKey('tab:tab-1')).toBeNull()
    expect(tabIdFromPaneKey('not-a-pane-key')).toBeNull()
    expect(tabIdFromPaneKey('')).toBeNull()
  })
})

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

  it('treats a retained legacy status key as that tab’s status row', () => {
    const result = localAgentTabsWithoutStatus(
      { w1: [{ id: 'tab-a', worktreeId: 'w1', viewMode: 'chat' }] },
      { 'tab-a:0': { agentType: 'claude' } }
    )

    expect(result).toEqual([])
  })

  /**
   * The container renders a status row only when it has an agent identity.
   * A row without one must not also hide the chat tab it belongs to, or the
   * agent disappears from Mission Control altogether.
   */
  it('keeps a chat tab whose only status row would not render as an agent', () => {
    const result = localAgentTabsWithoutStatus(
      { w1: [{ id: 'tab-a', worktreeId: 'w1', viewMode: 'chat' }] },
      { [`tab-a:${LEAF}`]: {} }
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.tab.id).toBe('tab-a')
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
