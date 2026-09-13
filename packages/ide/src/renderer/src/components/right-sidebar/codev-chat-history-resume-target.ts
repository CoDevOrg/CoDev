import type { AiVaultSessionResumeState } from './ai-vault-session-resume'
import type { AiVaultSessionWorktreeInfo } from './ai-vault-session-worktree'

/**
 * Which checkout a past chat is reopened in.
 *
 * The history list covers the whole project, so a chat from worktree B can be
 * clicked while worktree A is active. Resuming it in A silently continued the
 * conversation against a different branch and different files — and retired
 * A's agents to make room for it. The transcript's own worktree is the target
 * whenever it is still open and resumable; the active worktree is only ever a
 * fallback, and one the member is told about.
 */
export type CodevChatHistoryFallbackReason =
  /** The transcript recorded no working directory. */
  | 'no-recorded-worktree'
  /** The recorded directory is not an open checkout in this workspace. */
  | 'worktree-unavailable'
  /** The recorded checkout is archived. */
  | 'worktree-archived'
  /** The recorded checkout is open but cannot resume this transcript
   *  (a different execution host). */
  | 'worktree-unsupported'

export type CodevChatHistoryResumeTarget =
  | { kind: 'session-worktree'; worktreeId: string }
  | { kind: 'active-worktree'; worktreeId: string; reason: CodevChatHistoryFallbackReason }
  | { kind: 'blocked' }

export function resolveCodevChatHistoryResumeTarget(args: {
  worktreeInfo: AiVaultSessionWorktreeInfo | null
  resumeState: AiVaultSessionResumeState
}): CodevChatHistoryResumeTarget {
  const { worktreeInfo, resumeState } = args
  if (resumeState.blocked || !resumeState.worktreeId) {
    return { kind: 'blocked' }
  }
  if (resumeState.usesSessionWorktree) {
    return { kind: 'session-worktree', worktreeId: resumeState.worktreeId }
  }
  return {
    kind: 'active-worktree',
    worktreeId: resumeState.worktreeId,
    reason: fallbackReason(worktreeInfo)
  }
}

function fallbackReason(
  worktreeInfo: AiVaultSessionWorktreeInfo | null
): CodevChatHistoryFallbackReason {
  if (!worktreeInfo) {
    return 'no-recorded-worktree'
  }
  if (worktreeInfo.status === 'archived') {
    return 'worktree-archived'
  }
  if (worktreeInfo.status === 'unavailable' || !worktreeInfo.worktreeId) {
    return 'worktree-unavailable'
  }
  return 'worktree-unsupported'
}

/** The notice shown when a chat could not be reopened where it was recorded. */
export function codevChatHistoryFallbackNotice(
  reason: CodevChatHistoryFallbackReason,
  targetLabel: string | null
): { title: string; description: string } {
  const where = targetLabel ? `the current checkout (${targetLabel})` : 'the current checkout'
  const title = `Reopened in ${where}`
  switch (reason) {
    case 'no-recorded-worktree':
      return {
        title,
        description:
          'This chat did not record which checkout it ran in, so it continues against the branch and files you have open now.'
      }
    case 'worktree-archived':
      return {
        title,
        description:
          'The checkout this chat ran in is archived, so it continues against the branch and files you have open now.'
      }
    case 'worktree-unsupported':
      return {
        title,
        description:
          'The checkout this chat ran in cannot resume it from here, so it continues against the branch and files you have open now.'
      }
    case 'worktree-unavailable':
    default:
      return {
        title,
        description:
          'The checkout this chat ran in is no longer open, so it continues against the branch and files you have open now.'
      }
  }
}
