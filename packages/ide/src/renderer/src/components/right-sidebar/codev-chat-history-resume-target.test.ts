import { describe, expect, it } from 'vitest'
import {
  codevChatHistoryFallbackNotice,
  resolveCodevChatHistoryResumeTarget
} from './codev-chat-history-resume-target'
import type { AiVaultSessionWorktreeInfo } from './ai-vault-session-worktree'

function info(overrides: Partial<AiVaultSessionWorktreeInfo>): AiVaultSessionWorktreeInfo {
  return { status: 'active', label: 'feature/b', path: '/srv/b', worktreeId: 'wt-b', ...overrides }
}

describe('resolveCodevChatHistoryResumeTarget', () => {
  it('reopens a chat in the worktree its transcript belongs to, not the active one', () => {
    expect(
      resolveCodevChatHistoryResumeTarget({
        worktreeInfo: info({}),
        resumeState: { blocked: false, worktreeId: 'wt-b', usesSessionWorktree: true }
      })
    ).toEqual({ kind: 'session-worktree', worktreeId: 'wt-b' })
  })

  it('falls back to the active worktree only when the recorded one is not open, and says why', () => {
    expect(
      resolveCodevChatHistoryResumeTarget({
        worktreeInfo: info({ status: 'unavailable', worktreeId: undefined }),
        resumeState: { blocked: false, worktreeId: 'wt-a', usesSessionWorktree: false }
      })
    ).toEqual({ kind: 'active-worktree', worktreeId: 'wt-a', reason: 'worktree-unavailable' })

    expect(
      resolveCodevChatHistoryResumeTarget({
        worktreeInfo: null,
        resumeState: { blocked: false, worktreeId: 'wt-a', usesSessionWorktree: false }
      })
    ).toEqual({ kind: 'active-worktree', worktreeId: 'wt-a', reason: 'no-recorded-worktree' })

    expect(
      resolveCodevChatHistoryResumeTarget({
        worktreeInfo: info({ status: 'archived' }),
        resumeState: { blocked: false, worktreeId: 'wt-a', usesSessionWorktree: false }
      })
    ).toEqual({ kind: 'active-worktree', worktreeId: 'wt-a', reason: 'worktree-archived' })

    // The recorded checkout is open, but the resume resolver rejected it (host mismatch).
    expect(
      resolveCodevChatHistoryResumeTarget({
        worktreeInfo: info({}),
        resumeState: { blocked: false, worktreeId: 'wt-a', usesSessionWorktree: false }
      })
    ).toEqual({ kind: 'active-worktree', worktreeId: 'wt-a', reason: 'worktree-unsupported' })
  })

  it('blocks rather than guessing when no checkout can take the chat', () => {
    expect(
      resolveCodevChatHistoryResumeTarget({
        worktreeInfo: info({}),
        resumeState: { blocked: true, worktreeId: null, usesSessionWorktree: false }
      })
    ).toEqual({ kind: 'blocked' })
  })
})

describe('codevChatHistoryFallbackNotice', () => {
  it('names the checkout the chat actually landed in', () => {
    const notice = codevChatHistoryFallbackNotice('worktree-unavailable', 'main')
    expect(notice.title).toBe('Reopened in the current checkout (main)')
    expect(notice.description).toContain('no longer open')
  })

  it('still reads correctly without a branch label', () => {
    expect(codevChatHistoryFallbackNotice('no-recorded-worktree', null).title).toBe(
      'Reopened in the current checkout'
    )
  })
})
