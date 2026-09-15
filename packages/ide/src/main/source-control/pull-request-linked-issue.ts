import type { HostedReviewProvider } from '../../shared/hosted-review'
import type { PullRequestLinkedIssue } from '../../shared/pull-request-generation'
import { isLinkedIssueNumber } from '../../shared/source-control-ai-action-variables'
import type { WorkspaceLinkedItem } from '../../shared/types'
import { getIssue as getGitHubIssue } from '../github/issues'

export type PullRequestLinkedIssueMeta = {
  linkedIssue?: number | null
  linkedWorkItem?: WorkspaceLinkedItem | null
}

type LocalGitOptions = { wslDistro?: string }

function inferIssueProvider(
  meta: PullRequestLinkedIssueMeta,
  provider?: HostedReviewProvider | null
): 'github' | null {
  if (provider === 'github') {
    return provider
  }
  if (provider) {
    return null
  }
  if (meta.linkedWorkItem?.type === 'issue' && meta.linkedWorkItem.provider === 'github') {
    return 'github'
  }
  return isLinkedIssueNumber(meta.linkedIssue) ? 'github' : null
}

function fallbackTitle(
  meta: PullRequestLinkedIssueMeta,
  provider: 'github',
  number: number
): string {
  const item = meta.linkedWorkItem
  return item?.provider === provider && item.type === 'issue' && item.number === number
    ? item.title
    : '(title unavailable)'
}

export async function loadPullRequestLinkedIssue(args: {
  meta: PullRequestLinkedIssueMeta | null | undefined
  provider?: HostedReviewProvider | null
  repoPath: string
  connectionId?: string | null
  localGitOptions?: LocalGitOptions
}): Promise<PullRequestLinkedIssue | null> {
  if (!args.meta) {
    return null
  }
  const provider = inferIssueProvider(args.meta, args.provider)
  const number = provider === 'github' ? args.meta.linkedIssue : null
  if (!provider || !isLinkedIssueNumber(number)) {
    return null
  }

  const issue = await getGitHubIssue(
    args.repoPath,
    number,
    args.connectionId,
    args.localGitOptions
  )

  return {
    provider,
    number,
    title: issue?.title || fallbackTitle(args.meta, provider, number),
    description: issue?.description ?? ''
  }
}
