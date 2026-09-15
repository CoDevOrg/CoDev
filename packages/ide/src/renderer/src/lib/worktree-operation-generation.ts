import { getRuntimeEnvironmentConnectionGeneration } from '@/store/slices/runtime-status'
import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'
import {
  resolveWorktreeOperationRoute,
  type WorktreeOperationRoute
} from './worktree-operation-route'

type OperationRouteState = Parameters<typeof resolveWorktreeOperationRoute>[0]

export type WorktreeOperationGenerationGuard = {
  assertCurrent: () => WorktreeOperationRoute
}

export type WorktreeOperationGenerationSnapshot = {
  route: WorktreeOperationRoute
  runtimeConnectionGeneration: number | null
  runtimePairingRevision: number | undefined
}

export function captureWorktreeOperationGenerationSnapshot(
  expectedRoute: WorktreeOperationRoute
): WorktreeOperationGenerationSnapshot {
  const environmentId = expectedRoute.runtimeEnvironmentId
  return {
    route: expectedRoute,
    runtimeConnectionGeneration: environmentId
      ? getRuntimeEnvironmentConnectionGeneration(environmentId)
      : null,
    runtimePairingRevision: environmentId
      ? getRuntimeEnvironmentRevision(environmentId)
      : undefined
  }
}

export function assertWorktreeOperationGenerationSnapshotCurrent(
  getState: () => OperationRouteState,
  worktreeId: string,
  snapshot: WorktreeOperationGenerationSnapshot,
  createError: () => Error,
  resolveCurrentRoute?: () => WorktreeOperationRoute | null
): WorktreeOperationRoute {
  const environmentId = snapshot.route.runtimeEnvironmentId
  const currentRoute = resolveCurrentRoute
    ? resolveCurrentRoute()
    : resolveWorktreeOperationRoute(getState(), worktreeId)
  if (
    JSON.stringify(currentRoute) !== JSON.stringify(snapshot.route) ||
    (environmentId &&
      getRuntimeEnvironmentConnectionGeneration(environmentId) !==
        snapshot.runtimeConnectionGeneration) ||
    (environmentId &&
      getRuntimeEnvironmentRevision(environmentId) !== snapshot.runtimePairingRevision)
  ) {
    throw createError()
  }
  return snapshot.route
}

export function captureWorktreeOperationGenerationGuard(
  getState: () => OperationRouteState,
  worktreeId: string,
  expectedRoute: WorktreeOperationRoute,
  createError: () => Error,
  resolveCurrentRoute?: () => WorktreeOperationRoute | null
): WorktreeOperationGenerationGuard {
  const snapshot = captureWorktreeOperationGenerationSnapshot(expectedRoute)

  return {
    assertCurrent: () =>
      assertWorktreeOperationGenerationSnapshotCurrent(
        getState,
        worktreeId,
        snapshot,
        createError,
        resolveCurrentRoute
      )
  }
}
