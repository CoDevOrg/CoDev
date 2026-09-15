import { describe, expect, it } from 'vitest'
import { gitHubPRToChecksPanelReview, selectChecksPanelReview } from './checks-panel-review'
import type { PRInfo } from '../../../../shared/types'
import type { } from '../../../../shared/hosted-review'

function makePR(overrides: Partial<PRInfo> = {}): PRInfo {
  return {
    number: 42,
    title: 'Add merge queue support',
    state: 'open',
    url: 'https://github.com/acme/web/pull/42',
    checksStatus: 'success',
    updatedAt: '2026-06-02T00:00:00Z',
    mergeable: 'MERGEABLE',
    ...overrides
  }
}

describe('gitHubPRToChecksPanelReview', () => {
  // Why: the right-sidebar merge presenter reads these fields off the converted
  // review object. PR #4001 dropped them here, so review-required/merge-queue
  // PRs silently rendered as plain "Able to merge" (regressing PR #2856).
  it('propagates review and merge-queue metadata from the PR', () => {
    const review = gitHubPRToChecksPanelReview(
      makePR({
        reviewDecision: 'REVIEW_REQUIRED',
        mergeQueueRequired: true,
        mergeStateStatus: 'BLOCKED',
        autoMergeEnabled: true,
        autoMergeAllowed: false
      })
    )

    expect(review.reviewDecision).toBe('REVIEW_REQUIRED')
    expect(review.mergeQueueRequired).toBe(true)
    expect(review.mergeStateStatus).toBe('BLOCKED')
    expect(review.autoMergeEnabled).toBe(true)
    expect(review.autoMergeAllowed).toBe(false)
  })

  it('carries the base identity fields', () => {
    const review = gitHubPRToChecksPanelReview(makePR({ headSha: 'abc123' }))
    expect(review.provider).toBe('github')
    expect(review.number).toBe(42)
    expect(review.status).toBe('success')
    expect(review.headSha).toBe('abc123')
  })
})

describe('selectChecksPanelReview', () => {

  it('uses GitHub PR cache when no non-GitHub review is linked', () => {
    const selected = selectChecksPanelReview({
      hostedReview: null,
      pr: makePR({ number: 12, state: 'merged' }),
    })

    expect(selected).toMatchObject({ provider: 'github', number: 12, state: 'merged' })
  })

})
