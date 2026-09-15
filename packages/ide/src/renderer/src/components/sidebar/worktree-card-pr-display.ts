import type { HostedReviewInfo } from '../../../../shared/hosted-review'
import type { PRInfo, Worktree } from '../../../../shared/types'

type LinkedReviewMetadataProvider = Exclude<HostedReviewInfo['provider'], 'unsupported'>

export function isCachedMergedBranchPRCurrentForWorktree(
  cachedPR: PRInfo | HostedReviewInfo | null | undefined,
  worktree: Pick<Worktree, 'head'>
): boolean {
  return (
    cachedPR?.state === 'merged' &&
    typeof cachedPR.headSha === 'string' &&
    cachedPR.headSha.length > 0 &&
    typeof worktree.head === 'string' &&
    worktree.head.length > 0 &&
    // Why: a worktree behind its own merged PR (update-branch/web commits) is
    // still that PR's line of work; match the main-process visibility rule.
    (cachedPR.headSha === worktree.head || cachedPR.confirmedContainedHeadOid === worktree.head)
  )
}

export type WorktreeCardPrDisplay =
  | HostedReviewInfo
  | {
      provider: LinkedReviewMetadataProvider
      number: number
      title: string
      state?: HostedReviewInfo['state']
      url?: string
      status?: HostedReviewInfo['status']
    }

type WorktreeCardPrDisplayOptions = {
  reviewHintKey?: string
  /** GitHub PR number proven by a branch-scoped lookup. */
  branchLookupGitHubPRNumber?: number | null
}

function makeLinkedReviewFallback(
  provider: LinkedReviewMetadataProvider,
  number: number,
  review: HostedReviewInfo | null | undefined
): WorktreeCardPrDisplay {
  return {
    provider,
    number,
    // Why: linked review metadata is persisted before provider details are cached.
    // Keep the row visible on cold first render while the lookup catches up.
    title: review === null ? 'PR details unavailable' : 'Loading PR...'
  }
}

export function getWorktreeCardPrDisplay(
  review: HostedReviewInfo | null | undefined,
  linkedPR: number | null,
  options: WorktreeCardPrDisplayOptions = {}
): WorktreeCardPrDisplay | null {
  const hasLinkedReview = linkedPR !== null
  if (review) {
    if (review.provider === 'unsupported') {
      return review
    }
    if (linkedPR === null) {
      // Why: GitHub refreshes retain a linked-style request hint; trust only the separately recorded branch-lookup provenance.
      if (
        !hasLinkedReview &&
        options.branchLookupGitHubPRNumber != null &&
        options.branchLookupGitHubPRNumber === review.number
      ) {
        return review
      }
      // Why: GitHub linked lookups can outlive the worktree metadata that
      // requested them. A neutral branch lookup is safe to show unlinked.
      return options.reviewHintKey === '' ? review : null
    }
    if (review.number === linkedPR) {
      return review
    }
    return makeLinkedReviewFallback(review.provider, linkedPR, undefined)
  }

  if (linkedPR !== null) {
    return makeLinkedReviewFallback('github', linkedPR, review)
  }

  return null
}
