import type { HostedReviewInfo } from '../../shared/hosted-review'
import { hostedReviewInfoFromGitHubPRInfo } from '../../shared/hosted-review-github'
import type { PRInfo } from '../../shared/types'

export function mapGitHubReview(pr: PRInfo): HostedReviewInfo {
  return hostedReviewInfoFromGitHubPRInfo(pr)
}
