import { describe, expect, it } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import {
  buildCodevChatHistoryEntries,
  formatChatHistoryAge
} from './codev-chat-history-entries'

function session(overrides: Partial<AiVaultSession> & { id: string }): AiVaultSession {
  return {
    executionHostId: 'local',
    agent: 'claude',
    sessionId: overrides.id,
    title: 'A chat',
    cwd: '/repo',
    branch: 'agent/fix-login',
    model: null,
    filePath: `/transcripts/${overrides.id}.jsonl`,
    codexHome: null,
    createdAt: null,
    updatedAt: null,
    modifiedAt: '2026-09-01T10:00:00.000Z',
    messageCount: 12,
    totalTokens: 0,
    previewMessages: [],
    ...overrides
  } as AiVaultSession
}

describe('CoDev chat history entries', () => {
  it('orders chats newest first', () => {
    const entries = buildCodevChatHistoryEntries([
      session({ id: 'older', modifiedAt: '2026-09-01T09:00:00.000Z' }),
      session({ id: 'newer', modifiedAt: '2026-09-01T11:00:00.000Z' })
    ])
    expect(entries.map((entry) => entry.id)).toEqual(['newer', 'older'])
  })

  it('keeps only the newest read of a transcript scanned from two paths', () => {
    const entries = buildCodevChatHistoryEntries([
      session({
        id: 'a',
        sessionId: 'shared-transcript',
        modifiedAt: '2026-09-01T09:00:00.000Z'
      }),
      session({
        id: 'b',
        sessionId: 'shared-transcript',
        modifiedAt: '2026-09-01T12:00:00.000Z'
      })
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe('b')
  })

  it('marks the chat that is already open in a pane', () => {
    const entries = buildCodevChatHistoryEntries(
      [session({ id: 'open' }), session({ id: 'closed' })],
      [{ sessionId: 'open' }]
    )
    expect(entries.find((entry) => entry.id === 'open')?.isLive).toBe(true)
    expect(entries.find((entry) => entry.id === 'closed')?.isLive).toBe(false)
  })

  it('falls back to a readable title for an untitled transcript', () => {
    expect(buildCodevChatHistoryEntries([session({ id: 'x', title: '   ' })])[0]?.title).toBe(
      'Untitled chat'
    )
  })

  it('caps the list so a long-lived workspace does not render hundreds of rows', () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      session({ id: `s-${index}`, modifiedAt: `2026-09-01T10:${String(index).padStart(2, '0')}:00.000Z` })
    )
    expect(buildCodevChatHistoryEntries(many, [], 40)).toHaveLength(40)
  })

  it('describes how long ago a chat was touched', () => {
    const now = new Date('2026-09-01T12:00:00.000Z').getTime()
    expect(formatChatHistoryAge('2026-09-01T11:59:40.000Z', now)).toBe('just now')
    expect(formatChatHistoryAge('2026-09-01T11:30:00.000Z', now)).toBe('30m ago')
    expect(formatChatHistoryAge('2026-09-01T09:00:00.000Z', now)).toBe('3h ago')
    expect(formatChatHistoryAge('2026-08-29T12:00:00.000Z', now)).toBe('3d ago')
  })
})
