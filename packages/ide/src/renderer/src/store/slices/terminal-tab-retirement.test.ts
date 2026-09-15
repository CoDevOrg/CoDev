import { describe, expect, it } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import type { TerminalTab } from '../../../../shared/types'
import { } from '../../../../shared/constants'
import { } from '../../../../shared/ephemeral-setup-terminal-worktree-id'
import { } from '../../../../shared/workspace-scope'
import {
  buildTerminalTabRetirementPlan,
  buildTerminalTabRetirementPlans,
  removeSleepingAgentSessionsForTab
} from './terminal-tab-retirement'

type RetirementState = Parameters<typeof buildTerminalTabRetirementPlan>[0]

function makeTab(id: string, worktreeId: string, ptyId: string | null): TerminalTab {
  return {
    id,
    worktreeId,
    ptyId,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function makeState(overrides: Partial<RetirementState> = {}): RetirementState {
  return {
    worktreesByRepo: {
      repo: [
        { id: 'wt-1', repoId: 'repo', hostId: 'local' },
        { id: 'wt-2', repoId: 'repo', hostId: 'local' }
      ]
    },
    tabsByWorktree: {},
    unifiedTabsByWorktree: {},
    ptyIdsByTabId: {},
    terminalLayoutsByTabId: {},
    lastKnownRelayPtyIdByTabId: {},
    pendingReconnectPtyIdByTabId: {},
    ...overrides
  }
}

function makeSleepingRecord(paneKey: string, tabId?: string): SleepingAgentSessionRecord {
  return {
    paneKey,
    tabId,
    worktreeId: 'wt-1',
    agent: 'codex',
    providerSession: { key: 'session_id', id: paneKey },
    prompt: 'continue',
    state: 'working',
    capturedAt: 1,
    updatedAt: 1
  }
}

describe('terminal tab retirement planning', () => {

  it('protects a scoped runtime terminal referenced through its legacy alias', () => {
    const scoped = 'remote:env-1@@terminal-1'
    const legacy = 'remote:terminal-1'
    const state = makeState({
      settings: { activeRuntimeEnvironmentId: 'env-1' },
      worktreesByRepo: {
        repo: [
          { id: 'wt-1', repoId: 'repo' },
          { id: 'wt-2', repoId: 'repo' }
        ]
      },
      tabsByWorktree: {
        'wt-1': [makeTab('tab-1', 'wt-1', legacy)],
        'wt-2': [makeTab('tab-2', 'wt-2', scoped)]
      },
      ptyIdsByTabId: { 'tab-1': [legacy], 'tab-2': [scoped] }
    })

    const plan = buildTerminalTabRetirementPlan(state, 'tab-1')
    expect(plan.sharedPtyIds).toEqual([legacy])
    expect(plan.runtimeTerminals).toEqual([])
  })

  it('deduplicates legacy and scoped aliases owned by the closing tab', () => {
    const state = makeState({
      settings: { activeRuntimeEnvironmentId: 'env-1' },
      worktreesByRepo: { repo: [{ id: 'wt-1', repoId: 'repo' }] },
      tabsByWorktree: {
        'wt-1': [makeTab('tab-1', 'wt-1', 'remote:terminal-1')]
      },
      ptyIdsByTabId: {
        'tab-1': ['remote:terminal-1', 'remote:env-1@@terminal-1']
      }
    })

    expect(buildTerminalTabRetirementPlan(state, 'tab-1').runtimeTerminals).toEqual([
      {
        ptyId: 'remote:terminal-1',
        environmentId: null,
        handle: 'terminal-1'
      }
    ])
  })

  it('deduplicates batch-owned PTYs while protecting owners outside the close set', () => {
    const state = makeState({
      tabsByWorktree: {
        'wt-1': [
          makeTab('tab-1', 'wt-1', 'pty-batch'),
          makeTab('tab-2', 'wt-1', 'pty-batch'),
          makeTab('later-tab', 'wt-1', 'pty-external')
        ]
      },
      ptyIdsByTabId: {
        'tab-1': ['pty-batch', 'pty-external'],
        'tab-2': ['pty-batch'],
        'later-tab': ['pty-external']
      }
    })

    const plans = buildTerminalTabRetirementPlans(state, ['tab-1', 'tab-2'])

    expect(plans.get('tab-1')).toMatchObject({
      localOrSshPtyIds: ['pty-batch'],
      sharedPtyIds: ['pty-external']
    })
    expect(plans.get('tab-2')).toMatchObject({
      localOrSshPtyIds: [],
      cleanupOnlyPtyIds: ['pty-batch'],
      sharedPtyIds: []
    })
  })

  it('indexes live owners once for a 100-tab batch', () => {
    const tabs = Array.from({ length: 100 }, (_, index) =>
      makeTab(`tab-${index}`, 'wt-1', `pty-${index}`)
    )
    let terminalStoreScans = 0
    let unifiedStoreScans = 0
    const state = makeState({
      tabsByWorktree: new Proxy(
        { 'wt-1': tabs },
        {
          ownKeys(target) {
            terminalStoreScans += 1
            return Reflect.ownKeys(target)
          }
        }
      ),
      unifiedTabsByWorktree: new Proxy(
        {},
        {
          ownKeys(target) {
            unifiedStoreScans += 1
            return Reflect.ownKeys(target)
          }
        }
      ),
      ptyIdsByTabId: Object.fromEntries(tabs.map((tab, index) => [tab.id, [`pty-${index}`]]))
    })

    const plans = buildTerminalTabRetirementPlans(
      state,
      tabs.map((tab) => tab.id)
    )

    expect(plans).toHaveLength(100)
    expect(terminalStoreScans).toBe(1)
    expect(unifiedStoreScans).toBe(1)
  })
})

describe('sleeping agent retirement', () => {
  it('removes key- and metadata-owned records while preserving siblings by reference', () => {
    const sibling = makeSleepingRecord('tab-2:leaf-2', 'tab-2')
    const records = {
      'tab-1:leaf-1': makeSleepingRecord('tab-1:leaf-1'),
      'legacy-pane-key': makeSleepingRecord('legacy-pane-key', 'tab-1'),
      'tab-2:leaf-2': sibling
    }

    const next = removeSleepingAgentSessionsForTab(records, 'tab-1')
    expect(next).toEqual({ 'tab-2:leaf-2': sibling })
    expect(next['tab-2:leaf-2']).toBe(sibling)
    expect(removeSleepingAgentSessionsForTab(next, 'missing-tab')).toBe(next)
  })
})
