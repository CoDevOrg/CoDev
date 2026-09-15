/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: issue metadata hooks clear stale rows and track loading while async provider cache requests are in flight. */
import { useEffect, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { GitHubAssignableUser } from '../../../shared/types'
import {
  createMetadataRequestStore,
  getFreshMetadata,
  loadMetadata
} from './metadata-request-cache'

type MetadataState<T> = {
  data: T
  loading: boolean
  error: string | null
}

type GitHubMetadataOptions = {
  runtimeEnvironmentId?: string | null
  activeRuntimeEnvironmentId?: string | null
}

// ─── GitHub ────────────────────────────────────────────────

const ghLabelStore = createMetadataRequestStore<string[]>()
const ghAssigneeStore = createMetadataRequestStore<GitHubAssignableUser[]>()

export function useRepoLabels(
  repoPath: string | null,
  repoId?: string | null,
  options?: GitHubMetadataOptions
): MetadataState<string[]> {
  const [state, setState] = useState<MetadataState<string[]>>({
    data: [],
    loading: false,
    error: null
  })
  const activeKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!repoPath && !repoId) {
      return
    }
    const runtimeEnvironmentId =
      options?.runtimeEnvironmentId?.trim() || options?.activeRuntimeEnvironmentId?.trim() || null
    const repoSelector = repoId ?? repoPath ?? ''
    // Why: SSH/runtime metadata must not reuse host-path cache entries; the same
    // repo id may resolve through a different credential/runtime boundary.
    const cacheKey = runtimeEnvironmentId
      ? `runtime:${runtimeEnvironmentId}:${repoSelector}`
      : repoSelector
    const cached = getFreshMetadata(ghLabelStore, cacheKey)
    if (cached) {
      if (activeKeyRef.current !== cacheKey) {
        setState({ data: cached.data, loading: false, error: null })
        activeKeyRef.current = cacheKey
      }
      return
    }

    activeKeyRef.current = cacheKey
    const requestKey = cacheKey
    setState((s) => ({
      ...s,
      data: s.data.length ? ([] as typeof s.data) : s.data,
      loading: true,
      error: null
    }))
    loadMetadata(ghLabelStore, cacheKey, () =>
      runtimeEnvironmentId
        ? callRuntimeRpc<string[]>(
            { kind: 'environment', environmentId: runtimeEnvironmentId },
            'github.listLabels',
            { repo: repoSelector },
            { timeoutMs: 15_000 }
          )
        : window.api.gh
            .listLabels({ repoPath: repoPath ?? '', repoId: repoId ?? undefined })
            .then((labels) => labels as string[])
    )
      .then((data) => {
        if (activeKeyRef.current !== requestKey) {
          return
        }
        setState({ data, loading: false, error: null })
      })
      .catch((err) => {
        if (activeKeyRef.current !== requestKey) {
          return
        }
        activeKeyRef.current = null
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load labels'
        }))
      })
  }, [repoPath, repoId, options?.runtimeEnvironmentId, options?.activeRuntimeEnvironmentId])

  return state
}

export function useRepoAssignees(
  repoPath: string | null,
  repoId?: string | null,
  options?: GitHubMetadataOptions
): MetadataState<GitHubAssignableUser[]> {
  const [state, setState] = useState<MetadataState<GitHubAssignableUser[]>>({
    data: [],
    loading: false,
    error: null
  })
  const activeKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!repoPath && !repoId) {
      return
    }
    const runtimeEnvironmentId =
      options?.runtimeEnvironmentId?.trim() || options?.activeRuntimeEnvironmentId?.trim() || null
    const repoSelector = repoId ?? repoPath ?? ''
    // Why: SSH/runtime metadata must not reuse host-path cache entries; the same
    // repo id may resolve through a different credential/runtime boundary.
    const cacheKey = runtimeEnvironmentId
      ? `runtime:${runtimeEnvironmentId}:${repoSelector}`
      : repoSelector
    const cached = getFreshMetadata(ghAssigneeStore, cacheKey)
    if (cached) {
      if (activeKeyRef.current !== cacheKey) {
        setState({ data: cached.data, loading: false, error: null })
        activeKeyRef.current = cacheKey
      }
      return
    }

    activeKeyRef.current = cacheKey
    const requestKey = cacheKey
    setState((s) => ({
      ...s,
      data: s.data.length ? ([] as typeof s.data) : s.data,
      loading: true,
      error: null
    }))
    loadMetadata(ghAssigneeStore, cacheKey, () =>
      runtimeEnvironmentId
        ? callRuntimeRpc<GitHubAssignableUser[]>(
            { kind: 'environment', environmentId: runtimeEnvironmentId },
            'github.listAssignableUsers',
            { repo: repoSelector },
            { timeoutMs: 15_000 }
          )
        : window.api.gh
            .listAssignableUsers({ repoPath: repoPath ?? '', repoId: repoId ?? undefined })
            .then((users) => users as GitHubAssignableUser[])
    )
      .then((data) => {
        if (activeKeyRef.current !== requestKey) {
          return
        }
        setState({ data, loading: false, error: null })
      })
      .catch((err) => {
        if (activeKeyRef.current !== requestKey) {
          return
        }
        activeKeyRef.current = null
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load assignees'
        }))
      })
  }, [repoPath, repoId, options?.runtimeEnvironmentId, options?.activeRuntimeEnvironmentId])

  return state
}

export { useImmediateMutation } from './useImmediateMutation'
