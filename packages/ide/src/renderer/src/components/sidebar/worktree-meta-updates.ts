import { parseGitHubIssueOrPRLink, parseGitHubIssueOrPRNumber } from '@/lib/github-links'
import { parseIssueLinkInput, type IssueLinkProvider } from '../../../../shared/issue-link-input'
import type { WorkspaceSourceProvider } from '../../../../shared/new-workspace/workspace-source'
import type { WorkspaceLinkedItem, WorktreeMeta } from '../../../../shared/types'

export type WorktreeMetaSavedPayload = {
  worktreeId: string
  updates: Partial<WorktreeMeta>
}

/** What the user currently has typed in the dialog. */
export type WorktreeMetaDraft = {
  displayNameInput: string
  issueInput: string
  issueProvider: IssueLinkProvider
  prInput: string
  commentInput: string
}

/** The persisted state the dialog was seeded from. Captured once when the
 *  dialog opens: comparing a frozen draft against a live store would let a
 *  background write move the baseline and make an untouched field "dirty". */
export type WorktreeMetaSnapshot = {
  displayName: string
  comment: string
  issueInput: string
  issueProvider: IssueLinkProvider
}

/** The link state as it stands now, read at save time rather than at open.
 *  Displacement is decided against this: a CLI or background write that landed
 *  while the dialog was open must not survive a save the dialog warned would
 *  displace it. */
export type WorktreeMetaLiveLinks = {
  linkedIssue?: number | null
  linkedWorkItemProvider?: WorkspaceSourceProvider | null
  /** `linkedWorkItem` also describes PRs, which this row does not own. */
  linkedWorkItemType?: WorkspaceLinkedItem['type'] | null
}

export function parseExplicitGitHubIssueUrl(input: string): string | null {
  const trimmed = input.trim()
  const link = parseGitHubIssueOrPRLink(trimmed)
  if (!link || link.type !== 'issue') {
    return null
  }

  return trimmed
}

export function parseGitHubWorkItemNumberForMetaField(
  input: string,
  expectedType: 'issue' | 'pr'
): number | null {
  const link = parseGitHubIssueOrPRLink(input)
  if (link) {
    // Why: issue and PR numbers live in separate GitHub namespaces for refs;
    // a URL path mismatch must not silently link the other field.
    return link.type === expectedType ? link.number : null
  }

  return parseGitHubIssueOrPRNumber(input)
}

// Why: blanking the field means "fall back to the branch/folder name", and the
// empty string is how that intent is persisted. Emitting `undefined` instead
// put a present-but-undefined key into the store spread, wiping the live name
// and crashing the worktree palette (crash a1f81ea1).
function buildDisplayNameUpdate(
  draft: WorktreeMetaDraft,
  current: WorktreeMetaSnapshot
): Partial<WorktreeMeta> {
  const trimmed = draft.displayNameInput.trim()
  return trimmed === current.displayName ? {} : { displayName: trimmed }
}

// Why: persistence bumps lastActivityAt whenever a `comment` key is present, so
// re-emitting an unchanged note reorders the workspace under the time-decay
// sidebar sort on a save that only touched the issue link.
function buildCommentUpdate(
  draft: WorktreeMetaDraft,
  current: WorktreeMetaSnapshot
): Partial<WorktreeMeta> {
  const trimmed = draft.commentInput.trim()
  return trimmed === current.comment ? {} : { comment: trimmed }
}

/** Which issue a value names, ignoring spelling: `42` and `#42` are one GitHub
 *  link. Unparseable text compares as raw text: there is nothing to normalize,
 *  and the builder writes nothing for it anyway. */
function issueLinkIdentity(input: string, provider: IssueLinkProvider): string {
  const trimmed = input.trim()
  if (trimmed === '') {
    return ''
  }
  const parsed = parseIssueLinkInput(trimmed, provider)
  if (!parsed) {
    return `raw:${provider}:${trimmed}`
  }
  return `github:${parsed.number}`
}

// Why: normalized identity rather than trimmed text. Retyping the same issue in
// another spelling — `42` to `#42` — would otherwise enter the displacement
// path and clear the title and source context of the very link it re-states.
export function isIssueFieldDirty(
  draft: WorktreeMetaDraft,
  current: WorktreeMetaSnapshot
): boolean {
  return (
    issueLinkIdentity(draft.issueInput, draft.issueProvider) !==
    issueLinkIdentity(current.issueInput, current.issueProvider)
  )
}

/** Whether the value being saved names the very issue `linkedWorkItem` already
 *  describes. */
function keepsLinkedWorkItem(
  input: string,
  provider: IssueLinkProvider,
  live: WorktreeMetaLiveLinks
): boolean {
  const parsed = parseIssueLinkInput(input.trim(), provider)
  if (!parsed || live.linkedWorkItemType !== 'issue') {
    return false
  }
  return live.linkedWorkItemProvider === 'github' && parsed.number === live.linkedIssue
}

/** One issue per workspace. Emits nothing at all unless the field changed —
 *  the dialog opens focused on Comment, so an untouched field must never
 *  destroy a link the user came here to keep. */
function buildIssueLinkUpdates(
  draft: WorktreeMetaDraft,
  current: WorktreeMetaSnapshot,
  live: WorktreeMetaLiveLinks
): Partial<WorktreeMeta> {
  if (!isIssueFieldDirty(draft, current)) {
    return {}
  }

  const trimmed = draft.issueInput.trim()
  // Why: the linked work item and its source context describe the issue being
  // replaced. Leaving them would keep a stale title badge — but only when the
  // save names a *different* issue: a value that re-states the same one must
  // keep its own title and SSH/runtime routing context. Narrow on purpose:
  // `type` because the field also records the PR a workspace was created from.
  const displacedWorkItem: Partial<WorktreeMeta> =
    !keepsLinkedWorkItem(trimmed, draft.issueProvider, live) &&
    live.linkedWorkItemProvider === 'github' &&
    live.linkedWorkItemType === 'issue'
      ? { linkedWorkItem: null, linkedTaskSourceContext: null }
      : {}

  if (trimmed === '') {
    return {
      linkedIssue: null,
      ...displacedWorkItem
    }
  }

  const parsed = parseIssueLinkInput(trimmed, draft.issueProvider)
  if (!parsed) {
    // Why: unparseable input leaves every link untouched. `canSave` already
    // blocks this path, but the builder stays pure rather than relying on it.
    return {}
  }

  return {
    linkedIssue: parsed.number,
    ...displacedWorkItem
  }
}

// Requires the dialog to seed `prInput` from the persisted `linkedPR`: the blank
// input is written through as a clear, so an unseeded field drops the link on an
// untouched save.
function buildPrLinkUpdate(draft: WorktreeMetaDraft): Partial<WorktreeMeta> {
  const trimmed = draft.prInput.trim()
  if (trimmed === '') {
    return { linkedPR: null }
  }
  const number = parseGitHubWorkItemNumberForMetaField(trimmed, 'pr')
  return number === null ? {} : { linkedPR: number }
}

/** Pure save-payload builder for the worktree meta dialog: empty inputs clear
 *  the link (null), unparseable inputs leave it untouched (omitted). No key is
 *  ever emitted holding `undefined` — persistence raw-spreads updates, so a
 *  present-but-undefined key erases the stored value. */
export function buildWorktreeMetaUpdates(
  draft: WorktreeMetaDraft,
  current: WorktreeMetaSnapshot,
  live: WorktreeMetaLiveLinks
): Partial<WorktreeMeta> {
  return {
    ...buildCommentUpdate(draft, current),
    ...buildDisplayNameUpdate(draft, current),
    ...buildIssueLinkUpdates(draft, current, live),
    ...buildPrLinkUpdate(draft)
  }
}
