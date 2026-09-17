/* eslint-disable max-lines -- Branch projection inputs are kept together so every CoDev surface uses the same live state. */

import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { useAllWorktrees, useRepoMap } from '@/store/selectors'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { isCodevEmbedded } from '@/web/codev-embedded'
import { useCodevBranchPresence } from './use-codev-branch-presence'
import { displayName } from './codev-team-shared'
import {
  buildCodevBranchLocalActivity,
  buildCodevBranchSummaries,
  type CodevBranchSummary
} from './codev-branches-model'
import { reconcileCodevStatus } from './codev-status-model'

function runtimeEnvironmentIdForWorktree(
  worktree: CodevBranchSummary['worktree'],
  repoMap: ReadonlyMap<string, { executionHostId?: string | null }>
): string | null {
  if (!worktree) {
    return null
  }
  const direct = worktree.runtimeOwnerEnvironmentId?.trim()
  if (direct) {
    return direct
  }
  const worktreeHost = parseExecutionHostId(worktree.hostId)
  if (worktreeHost?.kind === 'runtime') {
    return worktreeHost.environmentId
  }
  const repoHost = parseExecutionHostId(repoMap.get(worktree.repoId)?.executionHostId)
  return repoHost?.kind === 'runtime' ? repoHost.environmentId : null
}

export type CodevBranchRowsState = {
  rows: CodevBranchSummary[]
  activeWorktreeId: string | null
  projectLoading: boolean
  workspaceReady: boolean
  bridge: ReturnType<typeof useCodevBranchPresence>['bridge']
  workboard: ReturnType<typeof useCodevBranchPresence>['workboard']
  roster: ReturnType<typeof useCodevBranchPresence>['roster']
  workboardError: string | null
  sharedSessions: ReturnType<typeof useCodevBranchPresence>['sharedSessions']
  sharedSessionsError: string | null
  status: ReturnType<typeof reconcileCodevStatus>
  rosterError: string | null
  refreshing: boolean
  refresh: () => Promise<void>
  retry: () => void
}

/**
 * Shared branch projection for the overview and the selected-branch shell.
 * Only the visible surface enables the live poll, so the two consumers never
 * issue duplicate requests while one of them is covering the other.
 */
export function useCodevBranchRows(active: boolean): CodevBranchRowsState {
  const embedded = isCodevEmbedded()
  const allWorktrees = useAllWorktrees()
  const repoMap = useRepoMap()
  const {
    agentStatusByPaneKey,
    tabsByWorktree,
    gitStatusByWorktree,
    gitBranchCompareSummaryByWorktree,
    gitConflictOperationByWorktree,
    runtimeStatusByEnvironmentId,
    repos,
    workspaceSessionReady,
    startupWorktreeRefreshCompleted,
    activeWorktreeId
  } = useAppStore(
    useShallow((state) => ({
      agentStatusByPaneKey: state.agentStatusByPaneKey,
      tabsByWorktree: state.tabsByWorktree,
      gitStatusByWorktree: state.gitStatusByWorktree,
      gitBranchCompareSummaryByWorktree: state.gitBranchCompareSummaryByWorktree,
      gitConflictOperationByWorktree: state.gitConflictOperationByWorktree,
      runtimeStatusByEnvironmentId: state.runtimeStatusByEnvironmentId,
      repos: state.repos,
      workspaceSessionReady: state.workspaceSessionReady,
      startupWorktreeRefreshCompleted: state.startupWorktreeRefreshCompleted,
      activeWorktreeId: state.activeWorktreeId
    }))
  )
  const presence = useCodevBranchPresence(embedded && active)
  const status = useMemo(
    () =>
      reconcileCodevStatus({
        bridge: presence.bridge.status,
        workboard: {
          value: presence.workboard,
          loaded: presence.workboard !== null,
          error: presence.workboardError,
          hadSuccessfulSnapshot: presence.workboard !== null,
          failedAt: presence.workboardErrorAt
        },
        sessions: {
          value: presence.sharedSessions,
          loaded: presence.sharedSessions !== null,
          error: presence.sharedSessionsError,
          hadSuccessfulSnapshot: presence.sharedSessions !== null,
          failedAt: presence.sharedSessionsErrorAt
        }
      }),
    [
      presence.bridge.status,
      presence.sharedSessions,
      presence.sharedSessionsError,
      presence.sharedSessionsErrorAt,
      presence.workboard,
      presence.workboardError,
      presence.workboardErrorAt
    ]
  )
  const projectPath = typeof window !== 'undefined' ? window.__CODEV_PROJECT_PATH__ : undefined
  const projectKind = typeof window !== 'undefined' ? window.__CODEV_PROJECT_KIND__ : undefined
  const projectRepoIds = useMemo(() => {
    if (!projectPath) {
      return new Set<string>()
    }
    return new Set(repos.filter((repo) => repo.path === projectPath).map((repo) => repo.id))
  }, [projectPath, repos])
  const projectLoading = projectKind === 'git' && Boolean(projectPath) && repos.length === 0
  const branchWorktrees = useMemo(
    () =>
      allWorktrees.filter(
        (worktree) =>
          !worktree.isArchived &&
          (projectKind !== 'git' || !projectPath || projectRepoIds.has(worktree.repoId))
      ),
    [allWorktrees, projectKind, projectPath, projectRepoIds]
  )
  const localActivity = useMemo(
    () => buildCodevBranchLocalActivity(Object.values(agentStatusByPaneKey), tabsByWorktree),
    [agentStatusByPaneKey, tabsByWorktree]
  )
  const runtimeDisconnectedByWorktree = useMemo(() => {
    const result: Record<string, boolean> = {}
    for (const worktree of branchWorktrees) {
      const environmentId = runtimeEnvironmentIdForWorktree(worktree, repoMap)
      if (environmentId) {
        const runtime = runtimeStatusByEnvironmentId.get(environmentId)
        if (runtime) {
          result[worktree.id] = runtime.status === null
        }
      }
    }
    return result
  }, [branchWorktrees, repoMap, runtimeStatusByEnvironmentId])
  const owners = useMemo(
    () =>
      presence.roster?.members.map((member) => ({
        name: displayName(member),
        accessRole: member.accessRole
      })) ?? [],
    [presence.roster]
  )
  const viewerName = useMemo(() => {
    const viewer = presence.roster?.members.find(
      (member) => member.isViewer || member.user.id === presence.roster?.viewerId
    )
    return viewer ? displayName(viewer) : (presence.workboard?.viewer?.name ?? null)
  }, [presence.roster, presence.workboard?.viewer?.name])
  const rows = useMemo(
    () =>
      buildCodevBranchSummaries({
        worktrees: branchWorktrees,
        slots: presence.workboard?.slots ?? [],
        viewerName,
        owners,
        localActivity,
        workingTreeEntriesByWorktree: gitStatusByWorktree,
        branchSummariesByWorktree: gitBranchCompareSummaryByWorktree,
        conflictOperationByWorktree: gitConflictOperationByWorktree,
        runtimeDisconnectedByWorktree,
        managedSessions: presence.sharedSessions ?? [],
        managedSessionsLoaded: presence.sharedSessions !== null,
        statusReconciling: status.feed.phase === 'reconciling'
      }),
    [
      branchWorktrees,
      gitBranchCompareSummaryByWorktree,
      gitConflictOperationByWorktree,
      gitStatusByWorktree,
      localActivity,
      owners,
      presence.sharedSessions,
      presence.workboard?.slots,
      runtimeDisconnectedByWorktree,
      status.feed.phase,
      viewerName
    ]
  )

  return {
    rows,
    activeWorktreeId,
    projectLoading,
    workspaceReady: workspaceSessionReady && startupWorktreeRefreshCompleted,
    status,
    ...presence
  }
}
