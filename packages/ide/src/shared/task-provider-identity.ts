import { githubRepoIdentityKey } from './github-repository-identity-key'
import type { TaskProvider } from './task-providers'
import type { ProjectProviderIdentity } from './types'

export type GitHubTaskProviderIdentity = ProjectProviderIdentity & {
  provider: 'github'
}

export type TaskProviderIdentity = GitHubTaskProviderIdentity

export function normalizeTaskProviderIdentity(
  provider: TaskProvider,
  identity: unknown
): TaskProviderIdentity | null {
  if (!identity || typeof identity !== 'object') {
    return null
  }
  const raw = identity as Record<string, unknown>
  if (raw.provider !== provider) {
    return null
  }
  const owner = normalizeNonEmptyString(raw.owner)
  const repo = normalizeNonEmptyString(raw.repo)
  if (!owner || !repo) {
    return null
  }
  const host = normalizeNonEmptyString(raw.host)
  return { provider, owner, repo, ...(host ? { host } : {}) }
}

export function isStoredTaskProviderIdentity(provider: TaskProvider, identity: unknown): boolean {
  if (identity === undefined || identity === null) {
    return true
  }
  if (typeof identity !== 'object') {
    return false
  }
  const raw = identity as Record<string, unknown>
  if (raw.provider !== provider) {
    return false
  }
  return (
    typeof raw.owner === 'string' &&
    raw.owner.trim().length > 0 &&
    typeof raw.repo === 'string' &&
    raw.repo.trim().length > 0 &&
    isNullableOptionalString(raw.host)
  )
}

const TASK_PROVIDER_IDENTITY_FIELDS: Record<TaskProvider, readonly string[]> = {
  github: ['owner', 'repo', 'host']
}

export function areTaskProviderIdentitiesEqual(
  a: TaskProviderIdentity | null | undefined,
  b: TaskProviderIdentity | null | undefined
): boolean {
  if (a === b) {
    return true
  }
  if (!a || !b) {
    return !a && !b
  }
  if (a.provider !== b.provider) {
    return false
  }
  const left = a as unknown as Record<string, unknown>
  const right = b as unknown as Record<string, unknown>
  return TASK_PROVIDER_IDENTITY_FIELDS[a.provider].every(
    (field) => (left[field] ?? null) === (right[field] ?? null)
  )
}

export function taskProviderIdentityCachePart(
  identity: TaskProviderIdentity | null | undefined
): string {
  if (!identity) {
    return ''
  }
  return githubRepoIdentityKey(identity)
}

function normalizeNonEmptyString(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed ? trimmed : null
}

function isNullableOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string'
}
