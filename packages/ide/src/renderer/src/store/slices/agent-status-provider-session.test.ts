import { describe, expect, it } from 'vitest'
import type { } from '../../../../shared/agent-session-resume'
import type { } from '../types'
import { } from '../../lib/sleeping-agent-pane-ownership'
import { createTestStore, } from './store-test-helpers'

describe('recordAgentProviderSession', () => {
  it('preserves the root session while a child permission hook moves Codex to waiting', () => {
    const store = createTestStore()
    const providerSession = { key: 'session_id' as const, id: 'root-session' }

    store
      .getState()
      .setAgentStatus(
        'tab-1:leaf-1',
        { state: 'working', prompt: 'coordinate reviewers', agentType: 'codex' },
        'Codex',
        { updatedAt: 10, stateStartedAt: 10 },
        undefined,
        { providerSession }
      )
    store.getState().setAgentStatus('tab-1:leaf-1', {
      state: 'waiting',
      prompt: 'coordinate reviewers',
      agentType: 'codex',
      subagents: [{ id: 'child-1', state: 'waiting', startedAt: 11 }]
    })

    expect(store.getState().agentStatusByPaneKey['tab-1:leaf-1']?.providerSession).toEqual(
      providerSession
    )
  })

  // Why: mobile Chat UI keys its transcript subscription on providerSession.id, so a
  // metadata-less end-of-turn `done` used to blank the chat every turn (#10630).
  it('keeps the provider session when the turn completes without session metadata', () => {
    const store = createTestStore()
    const providerSession = { key: 'session_id' as const, id: 'claude-session-1' }

    store
      .getState()
      .setAgentStatus(
        'tab-1:leaf-1',
        { state: 'working', prompt: 'summarize the diff', agentType: 'claude' },
        'Claude',
        { updatedAt: 10, stateStartedAt: 10 },
        undefined,
        { providerSession }
      )
    store.getState().setAgentStatus('tab-1:leaf-1', {
      state: 'done',
      prompt: 'summarize the diff',
      agentType: 'claude'
    })

    expect(store.getState().agentStatusByPaneKey['tab-1:leaf-1']?.providerSession).toEqual(
      providerSession
    )
  })

  // Why: `done` is the resting state, and both OSC 9999 repaints and reconnect snapshot
  // replays re-deliver a metadata-less `done` onto an already-done row. Retaining only the
  // first one still blanked the chat the moment a second landed (#10630).
  it('keeps the provider session across repeated metadata-less done pings', () => {
    const store = createTestStore()
    const providerSession = { key: 'session_id' as const, id: 'claude-session-1' }

    store
      .getState()
      .setAgentStatus(
        'tab-1:leaf-1',
        { state: 'working', prompt: 'summarize the diff', agentType: 'claude' },
        'Claude',
        { updatedAt: 10, stateStartedAt: 10 },
        undefined,
        { providerSession }
      )
    for (const prompt of ['summarize the diff', 'summarize the diff again']) {
      store
        .getState()
        .setAgentStatus('tab-1:leaf-1', { state: 'done', prompt, agentType: 'claude' })
    }

    expect(store.getState().agentStatusByPaneKey['tab-1:leaf-1']?.providerSession).toEqual(
      providerSession
    )
  })

  // Why: retention stops at the turn boundary. A metadata-less `working` after `done` starts
  // fresh work, so the finished session must not ride along into it.
  it('does not carry a completed session into the next turn', () => {
    const store = createTestStore()

    store
      .getState()
      .setAgentStatus(
        'tab-1:leaf-1',
        { state: 'working', prompt: 'first', agentType: 'claude' },
        'Claude',
        { updatedAt: 10, stateStartedAt: 10 },
        undefined,
        { providerSession: { key: 'session_id' as const, id: 'claude-session-1' } }
      )
    store
      .getState()
      .setAgentStatus('tab-1:leaf-1', { state: 'done', prompt: 'first', agentType: 'claude' })
    store
      .getState()
      .setAgentStatus('tab-1:leaf-1', { state: 'working', prompt: 'second', agentType: 'claude' })

    expect(store.getState().agentStatusByPaneKey['tab-1:leaf-1']?.providerSession).toBeUndefined()
  })

})
