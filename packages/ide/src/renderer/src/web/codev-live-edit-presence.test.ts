import { describe, expect, it } from 'vitest'

import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import {
  CODEV_LIVE_EDIT_TTL_MS,
  codevAgentPresenceColor,
  codevLiveEditsByWorktree,
  codevLiveEditsForFile,
  selectCodevLiveEdits,
} from './codev-live-edit-presence'

const NOW = 1_700_000_000_000

function entry(over: Partial<AgentStatusEntry> & { paneKey: string }): AgentStatusEntry {
  // Spreading a Partial widens the concrete defaults to `T | undefined`, so
  // assert back to the full shape once the merge is done.
  return {
    state: 'working',
    updatedAt: NOW,
    stateStartedAt: NOW,
    stateHistory: [],
    agentType: 'claude',
    worktreeId: 'wt-checkout-guard',
    toolName: 'Edit',
    toolInput: 'src/checkout/reserve.ts',
    ...over,
  } as AgentStatusEntry
}

function map(...entries: AgentStatusEntry[]): Record<string, AgentStatusEntry> {
  return Object.fromEntries(entries.map((row) => [row.paneKey, row]))
}

describe('selectCodevLiveEdits', () => {
  it('projects one fresh file edit per pane, newest first', () => {
    const rows = selectCodevLiveEdits(
      map(
        entry({ paneKey: 'tab-1:a', updatedAt: NOW - 5_000 }),
        entry({
          paneKey: 'tab-2:b',
          agentType: 'codex',
          worktreeId: 'wt-retry',
          toolName: 'write_file',
          toolInput: 'src/lib/retry.ts',
          updatedAt: NOW - 500,
        }),
      ),
      NOW,
    )
    expect(rows.map((row) => [row.filePath, row.agentKind])).toEqual([
      ['src/lib/retry.ts', 'codex'],
      ['src/checkout/reserve.ts', 'claude-code'],
    ])
    expect(rows[0]!.expiresInMs).toBeGreaterThan(0)
  })

  it('drops entries past the TTL, in the future, or not a file write', () => {
    const rows = selectCodevLiveEdits(
      map(
        entry({ paneKey: 'stale', updatedAt: NOW - CODEV_LIVE_EDIT_TTL_MS - 1 }),
        entry({ paneKey: 'future', updatedAt: NOW + 1_000 }),
        entry({ paneKey: 'reading', toolName: 'Read' }),
        entry({ paneKey: 'thinking', toolName: undefined, toolInput: undefined }),
        entry({ paneKey: 'no-worktree', worktreeId: undefined }),
      ),
      NOW,
    )
    expect(rows).toEqual([])
  })

  it('honours a custom ttl', () => {
    const rows = selectCodevLiveEdits(
      map(entry({ paneKey: 'p', updatedAt: NOW - 3_000 })),
      NOW,
      2_000,
    )
    expect(rows).toEqual([])
  })
})

describe('groupings', () => {
  const presence = selectCodevLiveEdits(
    map(
      entry({ paneKey: 'p1', updatedAt: NOW - 100 }),
      entry({
        paneKey: 'p2',
        agentType: 'cursor',
        toolInput: 'src/checkout/reserve.ts',
        updatedAt: NOW - 200,
      }),
      entry({
        paneKey: 'p3',
        agentType: 'gemini',
        worktreeId: 'wt-idempotency',
        toolInput: 'src/checkout/session.ts',
        updatedAt: NOW - 300,
      }),
    ),
    NOW,
  )

  it('codevLiveEditsForFile narrows to one file of one worktree', () => {
    const inFile = codevLiveEditsForFile(
      presence,
      'wt-checkout-guard',
      'src/checkout/reserve.ts',
    )
    expect(inFile.map((row) => row.agentKind).sort()).toEqual(['claude-code', 'cursor'])
  })

  it('codevLiveEditsByWorktree nests worktree -> file -> agents', () => {
    const grouped = codevLiveEditsByWorktree(presence)
    expect([...grouped.keys()].sort()).toEqual(['wt-checkout-guard', 'wt-idempotency'])
    expect(
      grouped.get('wt-checkout-guard')!.get('src/checkout/reserve.ts')!.length,
    ).toBe(2)
    expect(
      grouped.get('wt-idempotency')!.get('src/checkout/session.ts')!.length,
    ).toBe(1)
  })
})

describe('codevAgentPresenceColor', () => {
  it('is stable and distinct for known kinds', () => {
    expect(codevAgentPresenceColor('codex')).toBe(codevAgentPresenceColor('codex'))
    expect(codevAgentPresenceColor('codex')).not.toBe(codevAgentPresenceColor('cursor'))
  })

  it('derives a deterministic hue for the long tail', () => {
    expect(codevAgentPresenceColor('some-new-agent')).toBe(
      codevAgentPresenceColor('some-new-agent'),
    )
    expect(codevAgentPresenceColor('other')).toMatch(/^oklch\(/)
  })
})
