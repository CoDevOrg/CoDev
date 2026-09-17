import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../shared/types'
import type { CodevWorkboardSlot } from '../sidebar/CodevWorkboardView'
import type { CodevSharedSessionView } from '../right-sidebar/codev-shared-session-model'
import {
  buildCodevBranchLocalActivity,
  buildCodevBranchSummaries,
  findCodevWorktreeForManagedId,
  isGeneratedCodevBranchName
} from './codev-branches-model'

const baseWorktree = (overrides: Partial<Worktree> = {}): Worktree =>
  ({
    id: 'repo::/srv/codev/main',
    repoId: 'repo',
    path: '/srv/codev/main',
    branch: 'main',
    head: 'abc123',
    isBare: false,
    isMainWorktree: true,
    displayName: 'Main',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 100,
    ...overrides
  }) as Worktree

const slot = (overrides: Partial<CodevWorkboardSlot> = {}): CodevWorkboardSlot =>
  ({
    slot: 1,
    occupied: true,
    sessionId: 'session-1',
    worktreeId: 'agent-worktree',
    assignment: 'Checkout settings',
    owner: 'Yousef',
    provider: 'Claude',
    status: 'working',
    worktree: 'codev-agent-12345678-1234-1234-1234-123456789012',
    currentTask: 'Implement the change',
    elapsed: '00:42',
    ...overrides
  }) as CodevWorkboardSlot

const managedSession = (
  overrides: {
    state?: string
    connectionBlocked?: string | null
    worktreeId?: string
  } = {}
): CodevSharedSessionView => ({
  session: {
    sessionId: 'session-1',
    ownerId: 'owner-1',
    worktreeId: overrides.worktreeId ?? 'agent-worktree',
    provider: 'anthropic',
    model: 'claude-sonnet',
    state: overrides.state ?? 'running',
    activeTurnId: null,
    streamCursor: 0,
    queue: []
  },
  name: 'Agent session',
  ownerName: 'Yousef',
  worktreeStatus: 'active',
  model: 'claude-sonnet',
  worktreeName: 'feature/chat',
  transcript: [],
  lastCompletedAction: null,
  connectionBlocked: overrides.connectionBlocked ?? null
})

describe('isGeneratedCodevBranchName', () => {
  it('recognizes agent branch ids that should stay out of primary UI copy', () => {
    expect(isGeneratedCodevBranchName('codev-agent-12345678-1234-1234-1234-123456789012')).toBe(
      true
    )
    expect(isGeneratedCodevBranchName('feature/chat-first')).toBe(false)
  })
})

describe('findCodevWorktreeForManagedId', () => {
  it('resolves the local worktree through its durable CoDev comment', () => {
    const managedId = '33333333-3333-4333-8333-333333333333'
    const worktree = baseWorktree({
      id: 'orca-worktree-1',
      branch: 'codev-agent-33333333',
      isMainWorktree: false,
      comment: `codev-agent:${managedId}`
    })

    expect(findCodevWorktreeForManagedId([worktree], managedId)).toBe(worktree)
  })

  it('accepts an exact local id when the host exposes the managed id directly', () => {
    const managedId = '44444444-4444-4444-8444-444444444444'
    const worktree = baseWorktree({ id: managedId, isMainWorktree: false })

    expect(findCodevWorktreeForManagedId([worktree], managedId)).toBe(worktree)
  })

  it('refuses an ambiguous or unknown mapping instead of opening a different branch', () => {
    const managedId = '55555555-5555-4555-8555-555555555555'
    const first = baseWorktree({ id: 'orca-1', comment: `codev-agent:${managedId}` })
    const second = baseWorktree({ id: 'orca-2', comment: `codev-agent:${managedId}` })

    expect(findCodevWorktreeForManagedId([first, second], managedId)).toBeNull()
    expect(
      findCodevWorktreeForManagedId([first], '66666666-6666-4666-8666-666666666666')
    ).toBeNull()
  })
})

describe('buildCodevBranchLocalActivity', () => {
  it('deduplicates pane updates and includes launched chat tabs', () => {
    const activity = buildCodevBranchLocalActivity(
      [
        {
          paneKey: 'pane-1',
          tabId: 'tab-1',
          worktreeId: 'wt-1',
          agentType: 'claude',
          state: 'waiting',
          updatedAt: 20
        },
        {
          paneKey: 'pane-1',
          tabId: 'tab-1',
          worktreeId: 'wt-1',
          agentType: 'claude',
          state: 'working',
          updatedAt: 30
        }
      ],
      {
        'wt-1': [
          { id: 'tab-1', launchAgent: 'claude' },
          { id: 'tab-2', launchAgent: 'codex' }
        ]
      }
    )

    expect(activity.get('wt-1')).toEqual({
      count: 2,
      providers: ['claude', 'codex'],
      status: 'working',
      lastActivityAt: 30
    })
  })
})

describe('buildCodevBranchSummaries', () => {
  it('uses assignment as the friendly label and preserves owner/provider/status', () => {
    const worktree = baseWorktree({
      id: 'agent-worktree',
      branch: 'codev-agent-12345678-1234-1234-1234-123456789012',
      isMainWorktree: false,
      displayName: 'Agent workspace'
    })
    const [row] = buildCodevBranchSummaries({
      worktrees: [worktree],
      slots: [slot()],
      owners: [{ name: 'Yousef', accessRole: 'owner' }]
    })

    expect(row).toMatchObject({
      label: 'Checkout settings',
      owner: 'Yousef',
      provider: 'Claude',
      agentStatus: 'working',
      agentCount: 1,
      state: 'active'
    })
    expect(row.gitBranch).toBe('codev-agent-12345678-1234-1234-1234-123456789012')
  })

  it('does not invent a changed-file count before Git status is known', () => {
    const [row] = buildCodevBranchSummaries({
      worktrees: [baseWorktree()],
      slots: [],
      branchSummariesByWorktree: {
        'repo::/srv/codev/main': { changedFiles: 8, status: 'loading' }
      }
    })

    expect(row.changedFiles).toBeNull()
  })

  it('shows an occupied backend slot while its local worktree is provisioning', () => {
    const [row] = buildCodevBranchSummaries({
      worktrees: [],
      slots: [slot({ worktreeId: 'not-yet-mirrored' })]
    })

    expect(row).toMatchObject({
      id: 'codev-slot:1',
      label: 'Checkout settings',
      owner: 'Yousef',
      state: 'provisioning',
      agentCount: 1
    })
  })

  it('keeps a paused or stopped managed session out of the active state', () => {
    const worktree = baseWorktree({ id: 'agent-worktree', isMainWorktree: false })
    const [paused] = buildCodevBranchSummaries({
      worktrees: [worktree],
      slots: [slot()],
      managedSessions: [managedSession({ state: 'interrupted' })],
      managedSessionsLoaded: true
    })
    expect(paused).toMatchObject({ state: 'paused', agentStatus: 'Paused' })

    const [stopped] = buildCodevBranchSummaries({
      worktrees: [worktree],
      slots: [slot({ status: 'frozen' })],
      managedSessions: [managedSession({ state: 'completed' })],
      managedSessionsLoaded: true
    })
    expect(stopped).toMatchObject({ state: 'stopped', agentStatus: 'Stopped' })
  })

  it('matches a managed session through the durable worktree comment and surfaces provider failure', () => {
    const managedWorktreeId = '77777777-7777-4777-8777-777777777777'
    const worktree = baseWorktree({
      id: 'local-worktree',
      isMainWorktree: false,
      comment: `codev-agent:${managedWorktreeId}`
    })
    const [row] = buildCodevBranchSummaries({
      worktrees: [worktree],
      slots: [slot({ worktreeId: managedWorktreeId })],
      managedSessions: [
        managedSession({
          worktreeId: managedWorktreeId,
          connectionBlocked: 'Reconnect Anthropic before sending work.'
        })
      ],
      managedSessionsLoaded: true
    })

    expect(row).toMatchObject({
      agentCount: 1,
      providerReady: false,
      providerIssue: 'Reconnect Anthropic before sending work.',
      state: 'failed'
    })
  })

  it('deduplicates cached Git entries by path', () => {
    const [row] = buildCodevBranchSummaries({
      worktrees: [baseWorktree()],
      slots: [],
      workingTreeEntriesByWorktree: {
        'repo::/srv/codev/main': [
          { path: 'src/app.ts' },
          { path: 'src/app.ts' },
          { path: 'README.md' }
        ]
      }
    })

    expect(row.changedFiles).toBe(2)
  })
})
