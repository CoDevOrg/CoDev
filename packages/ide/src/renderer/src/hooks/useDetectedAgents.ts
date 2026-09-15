import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../shared/types'

export type UseDetectedAgentsResult = {
  /** Null while detection is in flight on first load. */
  detectedIds: TuiAgent[] | null
  isLoading: boolean
  /** True when the first probe for this mounted remote target finished without a result. */
  detectionFailed: boolean
  isRefreshing: boolean
  /** Forces a re-detect on the target host (`preflight.refreshAgents` for
   *  local/runtime targets) and updates every
   *  subscribed surface in the same tick. Idempotent while in flight:
   *  concurrent callers receive the same pending promise. */
  refresh: () => Promise<TuiAgent[]>
}

export type AgentDetectionTarget = { kind: 'local' } | { kind: 'runtime'; environmentId: string }

function normalizeAgentDetectionTarget(
  target: AgentDetectionTarget | null | undefined
): AgentDetectionTarget | undefined {
  if (target === undefined) {
    return undefined
  }
  if (target === null) {
    return { kind: 'local' }
  }
  return target
}

/**
 * Single source of truth for detected agent IDs across the renderer.
 *
 * Why: previously AgentsPane, NewWorkspaceComposerCard, and
 * `detect-agents-cached.ts` each ran their own detection. A tab-bar button
 * that doesn't refresh when Settings → Agents refreshes would feel broken;
 * centralizing the state eliminates multi-owner drift.
 *
 * @param detectionTarget — An AgentDetectionTarget for local/runtime hosts.
 * Pass null for local detection. Pass undefined when the host context is not
 * yet known (store not hydrated) — returns loading state.
 */
export function useDetectedAgents(
  detectionTarget: AgentDetectionTarget | null | undefined
): UseDetectedAgentsResult {
  const target = normalizeAgentDetectionTarget(detectionTarget)
  const observedRemoteTargetKeysRef = useRef<Set<string>>(new Set())
  // Why: undefined means "store not yet hydrated" — we don't know if the
  // worktree is local or remote yet. This prevents flashing local agents for
  // remote worktrees during hydration.
  const isUnknown = target === undefined
  const targetKind = target?.kind
  const targetId = target?.kind === 'runtime' ? target.environmentId : null
  const remoteTargetKey = targetKind === 'runtime' && targetId ? `runtime:${targetId}` : null

  const detectedIds = useAppStore((s) => {
    if (isUnknown) {
      return null
    }
    if (targetKind === 'runtime' && targetId) {
      return s.runtimeDetectedAgentIds[targetId] ?? null
    }
    return s.detectedAgentIds
  })
  const isLoading = useAppStore((s) => {
    if (isUnknown) {
      return true
    }
    if (targetKind === 'runtime' && targetId) {
      return s.isDetectingRuntimeAgents[targetId] ?? false
    }
    return s.isDetectingAgents
  })
  const isRefreshing = useAppStore((s) => {
    if (targetKind === 'runtime' && targetId) {
      return s.isRefreshingRuntimeAgents[targetId] ?? false
    }
    return targetKind === 'local' ? s.isRefreshingAgents : false
  })
  const detectionFailed =
    detectedIds === null &&
    !isLoading &&
    !isRefreshing &&
    remoteTargetKey !== null &&
    observedRemoteTargetKeysRef.current.has(remoteTargetKey)
  // Why: refresh must hit the same host the list came from — refreshing the
  // local PATH while showing a remote server's agents is a silent no-op.
  const refresh = useCallback((): Promise<TuiAgent[]> => {
    if (isUnknown) {
      return Promise.resolve([])
    }
    // Why: retained tab bars stay mounted; imperative action reads avoid six
    // no-op Zustand subscriptions per hook during unrelated store churn.
    const state = useAppStore.getState()
    if (targetKind === 'runtime' && targetId) {
      return state.refreshRuntimeDetectedAgents(targetId)
    }
    return state.refreshDetectedAgents()
  }, [isUnknown, targetKind, targetId])

  useEffect(() => {
    if (isUnknown) {
      return
    }
    const isNewRemoteTarget =
      remoteTargetKey !== null && !observedRemoteTargetKeysRef.current.has(remoteTargetKey)
    // Why: switching A → B → A is still one mounted surface; remember every
    // target so empty hosts don't respawn all detection subprocesses on each switch.
    if (remoteTargetKey !== null) {
      observedRemoteTargetKeysRef.current.add(remoteTargetKey)
    }
    const state = useAppStore.getState()
    if (targetKind === 'runtime' && targetId) {
      if (detectedIds === null) {
        void state.ensureRuntimeDetectedAgents(targetId)
      } else if (detectedIds.length === 0 && isNewRemoteTarget) {
        // Why: remote `orca serve` users can install/fix PATH without reconnecting;
        // retry once per mounted surface so the menu can pick that up.
        void state.ensureRuntimeDetectedAgents(targetId)
      }
    } else {
      if (detectedIds === null) {
        void state.ensureDetectedAgents()
      }
    }
  }, [isUnknown, targetKind, targetId, remoteTargetKey, detectedIds])

  return { detectedIds, isLoading, detectionFailed, isRefreshing, refresh }
}
