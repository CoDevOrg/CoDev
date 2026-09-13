import type { CodevReviewCheckpoint } from './codev-review-checkpoint-snapshot'

/**
 * Which checkpoint the panel acts on, and on what authority.
 *
 * The active worktree's own checkpoint is the only automatic choice. When the
 * active checkout has none — because it is not an agent proposal, or its
 * proposal has no checkpoint yet — nothing is substituted: Prepare and Approve
 * used to fall back to the last prepared checkpoint of some other worktree,
 * so controls inside one checkout's Source Control could act on a different
 * proposal. A checkpoint from another worktree is used only when the member
 * picks it, and the pick is scoped to the checkout it was made in.
 */
export type CodevReviewCheckpointChoice = {
  worktreeId: string | null
  sessionId: string
}

export type CodevReviewCheckpointSelection =
  | { source: 'worktree'; checkpoint: CodevReviewCheckpoint }
  | { source: 'chosen'; checkpoint: CodevReviewCheckpoint }
  | {
      source: 'none'
      checkpoint: null
      reason: 'no-checkpoints' | 'not-a-proposal' | 'no-checkpoint-for-worktree'
    }

export function selectCodevReviewCheckpoint(
  checkpoints: CodevReviewCheckpoint[],
  worktreeId: string | null,
  choice: CodevReviewCheckpointChoice | null = null
): CodevReviewCheckpointSelection {
  if (worktreeId) {
    const matched = checkpoints.find((checkpoint) => checkpoint.worktreeId === worktreeId)
    if (matched) {
      return { source: 'worktree', checkpoint: matched }
    }
  }
  if (choice && choice.worktreeId === worktreeId) {
    const chosen = checkpoints.find((checkpoint) => checkpoint.sessionId === choice.sessionId)
    if (chosen) {
      return { source: 'chosen', checkpoint: chosen }
    }
  }
  if (checkpoints.length === 0) {
    return { source: 'none', checkpoint: null, reason: 'no-checkpoints' }
  }
  return {
    source: 'none',
    checkpoint: null,
    reason: worktreeId ? 'no-checkpoint-for-worktree' : 'not-a-proposal'
  }
}

export function checkpointChoiceLabel(checkpoint: CodevReviewCheckpoint): string {
  const slot = checkpoint.slot ? `Slot ${checkpoint.slot} · ` : ''
  const state = checkpoint.prepared ? 'checkpoint prepared' : 'not prepared'
  return `${slot}${checkpoint.assignment} · ${checkpoint.worktree} · ${state}`
}

export function unmatchedNotice(
  reason: Extract<CodevReviewCheckpointSelection, { source: 'none' }>['reason']
): string {
  switch (reason) {
    case 'no-checkpoints':
      return 'No agent proposal has a review checkpoint yet.'
    case 'no-checkpoint-for-worktree':
      return 'This proposal worktree has no review checkpoint yet. To review a different proposal here, choose it below.'
    case 'not-a-proposal':
    default:
      return 'This checkout is not an agent proposal. To review one here, choose it below.'
  }
}
