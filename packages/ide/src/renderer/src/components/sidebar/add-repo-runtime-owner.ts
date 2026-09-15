import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'

export type CapturedRuntimeOwner = string | null | undefined

export function capturedAddRepoExecutionHostId(
  owner: CapturedRuntimeOwner
): ExecutionHostId | undefined {
  return owner !== undefined
    ? owner
      ? toRuntimeExecutionHostId(owner)
      : LOCAL_EXECUTION_HOST_ID
    : undefined
}

export function worktreeRefreshOptions(owner: CapturedRuntimeOwner): {
  requireAuthoritative: true
  executionHostId?: ExecutionHostId
} {
  const executionHostId = capturedAddRepoExecutionHostId(owner)
  return {
    requireAuthoritative: true,
    ...(executionHostId ? { executionHostId } : {})
  }
}
