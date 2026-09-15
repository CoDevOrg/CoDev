import { parseExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import type {
  WorktreeOperationOwnerRecord,
  WorktreeOperationRoute,
  WorktreeOperationRouteResolution,
  WorktreeOperationRouteState
} from './worktree-operation-route'

export function routeForOwner(owner: {
  hostId?: ExecutionHostId
  runtimeOwnerEnvironmentId?: string
}): WorktreeOperationRoute | null {
  const runtimeOwnerEnvironmentId = owner.runtimeOwnerEnvironmentId?.trim()
  if (!owner.hostId && !runtimeOwnerEnvironmentId) {
    return null
  }
  const parsedHost = parseExecutionHostId(owner.hostId)
  return {
    executionHostId: owner.hostId ?? null,
    runtimeEnvironmentId:
      runtimeOwnerEnvironmentId ||
      (parsedHost?.kind === 'runtime' ? parsedHost.environmentId : null)
  }
}

export function addRoute(
  routes: Map<string, WorktreeOperationRoute>,
  route: WorktreeOperationRoute | null
): void {
  if (!route) {
    return
  }
  routes.set(JSON.stringify(route), route)
}

export function resolveExactWorktreeRoute(
  _state: WorktreeOperationRouteState,
  owner: WorktreeOperationOwnerRecord
): WorktreeOperationRouteResolution {
  const route = routeForOwner(owner)
  if (!route) {
    return { kind: 'missing' }
  }
  return { kind: 'resolved', route }
}
