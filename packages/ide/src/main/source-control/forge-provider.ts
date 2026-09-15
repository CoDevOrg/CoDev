import type {
  CreateHostedReviewInput,
  CreateHostedReviewResult,
  HostedReviewInfo,
  HostedReviewProvider
} from '../../shared/hosted-review'
import {
  createGitHubPullRequest,
  getGitHubPRLookupRateLimitBlock,
  getPRForBranchOutcome,
  getRepoSlug
} from '../github/client'
import { mapGitHubReview } from './forge-review-mappers'
import {
  hasHostedReviewLocalGitOptions,
  getHostedReviewLocalGitOptions,
  type HostedReviewExecutionOptions
} from './hosted-review-git-options'

export type ForgeProviderId = Exclude<HostedReviewProvider, 'unsupported'>

export type ForgeProviderRepositoryContext = HostedReviewExecutionOptions & {
  repoPath: string
  connectionId?: string | null
}

export type ForgeReviewForBranchInput = ForgeProviderRepositoryContext & {
  branch: string
  linkedReviewNumber?: number | null
  fallbackReviewNumber?: number | null
  // Lets the GitHub provider keep merged-at-head PRs visible using the
  // inspected worktree HEAD.
  githubCurrentHeadOid?: string | null
}

export type ForgeReviewByNumberInput = ForgeProviderRepositoryContext & {
  number: number
}

export type ForgeProvider = {
  id: ForgeProviderId
  supportsReviewCreation: boolean
  resolveRepository(context: ForgeProviderRepositoryContext): Promise<unknown | null>
  getReviewForBranch(input: ForgeReviewForBranchInput): Promise<HostedReviewInfo | null>
  getReviewByNumber(input: ForgeReviewByNumberInput): Promise<HostedReviewInfo | null>
  createReview?(
    repoPath: string,
    input: CreateHostedReviewInput,
    connectionId?: string | null,
    options?: HostedReviewExecutionOptions
  ): Promise<CreateHostedReviewResult>
}

function hostedReviewExecutionArgs(
  options: HostedReviewExecutionOptions
): [] | [HostedReviewExecutionOptions] {
  return hasHostedReviewLocalGitOptions(options)
    ? [{ localGitExecOptions: getHostedReviewLocalGitOptions(options) }]
    : []
}

// Why: collapsing an upstream error into a null "no review" lets a transient
// gh/git failure poison the sidebar's hosted-review cache with a definitive
// miss. Surface the error so callers can preserve the last known review state,
// mirroring how the PR refresh coordinator keeps cache on upstream-error.
function unwrapGitHubPRForBranchOutcome(
  outcome: Awaited<ReturnType<typeof getPRForBranchOutcome>>
): HostedReviewInfo | null {
  if (outcome.kind === 'upstream-error') {
    throw new Error(`GitHub PR lookup failed (${outcome.errorType}): ${outcome.message}`)
  }
  return outcome.kind === 'found' ? mapGitHubReview(outcome.pr) : null
}

/**
 * Why (#11532): hosted-review lookups reach GitHub outside the PR refresh
 * coordinator's paced queue, so they need the same rate-limit floor. Throwing
 * (rather than returning null) keeps a low budget from reading as "no pull
 * request" — callers preserve the last known review and back off.
 */
async function assertGitHubReviewRateLimitBudget(
  input: ForgeProviderRepositoryContext
): Promise<void> {
  const block = await getGitHubPRLookupRateLimitBlock(
    input.repoPath,
    input.connectionId,
    getHostedReviewLocalGitOptions(input)
  )
  if (block) {
    throw new Error(
      `GitHub PR lookup failed (rate_limited): GitHub rate limit is low. Try again after ${new Date(
        block.resetAt * 1000
      ).toLocaleTimeString()}.`
    )
  }
}

const gitHubForgeProvider = {
  id: 'github',
  supportsReviewCreation: true,
  // Why: getRepoSlug resolves hosted identities — GHES remotes are claimed when
  // gh is authenticated to their host (#8312).
  resolveRepository: async (context) =>
    getRepoSlug(context.repoPath, context.connectionId, ...hostedReviewExecutionArgs(context)),
  async getReviewForBranch(input) {
    await assertGitHubReviewRateLimitBudget(input)
    const fallbackReviewNumber =
      input.linkedReviewNumber == null ? (input.fallbackReviewNumber ?? null) : null
    const executionArgs = hostedReviewExecutionArgs(input)
    const outcome = await getPRForBranchOutcome(
      input.repoPath,
      input.branch,
      input.linkedReviewNumber ?? null,
      input.connectionId,
      fallbackReviewNumber,
      {
        ...executionArgs[0],
        ...(fallbackReviewNumber !== null ? { acceptMergedFallbackPR: true } : {}),
        currentHeadOid: input.githubCurrentHeadOid ?? null
      }
    )
    return unwrapGitHubPRForBranchOutcome(outcome)
  },
  async getReviewByNumber(input) {
    await assertGitHubReviewRateLimitBudget(input)
    const executionArgs = hostedReviewExecutionArgs(input)
    const outcome =
      executionArgs.length > 0
        ? await getPRForBranchOutcome(
            input.repoPath,
            '',
            input.number,
            input.connectionId,
            null,
            ...executionArgs
          )
        : await getPRForBranchOutcome(input.repoPath, '', input.number, input.connectionId)
    return unwrapGitHubPRForBranchOutcome(outcome)
  },
  createReview: createGitHubPullRequest
} satisfies ForgeProvider

export const FORGE_PROVIDERS = [gitHubForgeProvider] as const satisfies readonly ForgeProvider[]

export function getForgeProviderById(id: ForgeProviderId): ForgeProvider {
  return FORGE_PROVIDERS.find((provider) => provider.id === id) ?? gitHubForgeProvider
}

export async function getForgeProviderForRepository(
  context: ForgeProviderRepositoryContext
): Promise<ForgeProvider | null> {
  for (const provider of FORGE_PROVIDERS) {
    if (await provider.resolveRepository(context)) {
      return provider
    }
  }
  return null
}

export async function detectHostedReviewProvider(
  context: ForgeProviderRepositoryContext
): Promise<HostedReviewProvider> {
  return (await getForgeProviderForRepository(context))?.id ?? 'unsupported'
}
