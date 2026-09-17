import { describe, expect, it } from 'vitest'
import type { CodevWorkboardSnapshot } from '../sidebar/CodevWorkboardView'
import type { CodevSharedSessionView } from '../right-sidebar/codev-shared-session-model'
import { managedAgentStatus, reconcileCodevStatus } from './codev-status-model'

function workboard(worktreeId = 'wt-1'): CodevWorkboardSnapshot {
  return {
    viewer: { id: 'viewer', name: 'You', canCoSteer: true },
    capacity: { maxActiveSessions: 3, activeSessions: 1, availableSlots: 2 },
    slots: [
      {
        slot: 1,
        occupied: true,
        sessionId: 'session-1',
        worktreeId,
        assignment: 'Agent',
        owner: 'You',
        provider: 'anthropic',
        status: 'Running',
        worktree: 'feature/chat',
        currentTask: 'Implement the change',
        elapsed: '00:10'
      },
      {
        slot: 2,
        occupied: false,
        sessionId: null,
        worktreeId: null,
        assignment: 'Available',
        owner: 'Unassigned',
        provider: '—',
        status: 'Available',
        worktree: 'No worktree',
        currentTask: 'Start an agent session to fill this slot.',
        elapsed: '00:00'
      },
      {
        slot: 3,
        occupied: false,
        sessionId: null,
        worktreeId: null,
        assignment: 'Available',
        owner: 'Unassigned',
        provider: '—',
        status: 'Available',
        worktree: 'No worktree',
        currentTask: 'Start an agent session to fill this slot.',
        elapsed: '00:00'
      }
    ],
    rejection: null
  }
}

function session(overrides: Partial<CodevSharedSessionView> = {}): CodevSharedSessionView {
  const base: CodevSharedSessionView = {
    session: {
      sessionId: 'session-1',
      ownerId: 'owner-1',
      worktreeId: 'wt-1',
      provider: 'anthropic',
      model: 'claude-sonnet',
      state: 'running',
      activeTurnId: 'turn-1',
      streamCursor: 1,
      queue: []
    },
    name: 'Agent',
    ownerName: 'You',
    worktreeStatus: 'active',
    worktreeName: 'feature/chat',
    model: 'claude-sonnet',
    transcript: [],
    lastCompletedAction: null
  }
  const { session: sessionOverride, ...viewOverrides } = overrides
  return {
    ...base,
    ...viewOverrides,
    session: { ...base.session, ...sessionOverride }
  }
}

describe('reconcileCodevStatus', () => {
  it('publishes slot counts only when workboard and session feeds agree', () => {
    const result = reconcileCodevStatus({
      bridge: 'connected',
      workboard: {
        value: workboard(),
        loaded: true,
        error: null,
        hadSuccessfulSnapshot: true,
        failedAt: null
      },
      sessions: {
        value: [session()],
        loaded: true,
        error: null,
        hadSuccessfulSnapshot: true,
        failedAt: null
      }
    })

    expect(result.feed.phase).toBe('live')
    expect(result.slots).toEqual({ used: 1, total: 3 })
  })

  it('holds back contradictory counts during a refresh race', () => {
    const result = reconcileCodevStatus({
      bridge: 'connected',
      workboard: {
        value: workboard('wt-new'),
        loaded: true,
        error: null,
        hadSuccessfulSnapshot: true,
        failedAt: null
      },
      sessions: {
        value: [session()],
        loaded: true,
        error: null,
        hadSuccessfulSnapshot: true,
        failedAt: null
      }
    })

    expect(result.feed.phase).toBe('reconciling')
    expect(result.slots).toBeNull()
  })

  it('marks a revoked provider as blocked without hiding the session', () => {
    const view = session({
      session: { ...session().session, state: 'idle' },
      connectionBlocked: 'This Anthropic connection was revoked or is not connected.'
    })

    expect(managedAgentStatus(view)).toMatchObject({
      state: 'starting',
      providerReadiness: 'blocked',
      providerIssue: view.connectionBlocked
    })
  })

  it('reports failed and paused lifecycle states distinctly', () => {
    expect(
      managedAgentStatus(
        session({
          session: { ...session().session, state: 'failed' },
          lastError: 'Sandbox failed.'
        })
      )
    ).toMatchObject({
      state: 'failed',
      label: 'Failed',
      detail: 'Sandbox failed.'
    })
    expect(
      managedAgentStatus(session({ session: { ...session().session, state: 'interrupted' } }))
    ).toMatchObject({
      state: 'paused',
      label: 'Paused'
    })
  })
})
