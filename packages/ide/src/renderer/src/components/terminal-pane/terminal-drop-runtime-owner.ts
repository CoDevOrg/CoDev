import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { useAppStore } from '@/store'

export function captureRuntimeTerminalDropOwner(worktreeId: string): {
  runtimeEnvironmentId: string
  assertCurrent: () => void
} | null {
  const state = useAppStore.getState()
  const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  if (!runtimeEnvironmentId) {
    return null
  }
  const assertCurrent = (): void => {
    const currentState = useAppStore.getState()
    const currentRuntimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(currentState, worktreeId)
    if (currentRuntimeEnvironmentId !== runtimeEnvironmentId) {
      throw new Error('Terminal upload host changed; retry the drop.')
    }
  }
  return { runtimeEnvironmentId, assertCurrent }
}
