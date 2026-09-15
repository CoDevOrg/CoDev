import type { Store } from '../persistence'
import { resolveGitStatusUpstreamRef } from '../git/status-upstream-ref'
import { gitExecFileAsync } from '../git/runner'
import { resolveRegisteredWorktreePath } from './filesystem-auth'
import {
  getLocalGitOptionsForRepo,
  getLocalRepoForRegisteredWorktree
} from './local-worktree-runtime-options'
import { setWorktreeGitStatusRefWatch } from './worktree-base-directory-watcher'
import type { GitStatusRefBindingRequest } from './worktree-git-status-ref-watch'

export type GitStatusUpstreamRefWatchRequest = Omit<
  GitStatusRefBindingRequest,
  'providerGeneration'
>

const UPSTREAM_REF_RESOLUTION_TIMEOUT_MS = 15_000

function boundedSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_REF_RESOLUTION_TIMEOUT_MS)])
}

export function applyGitStatusUpstreamRefWatchRequest(
  store: Store,
  args: GitStatusUpstreamRefWatchRequest
): Promise<void> {
  return setWorktreeGitStatusRefWatch(
    { ...args },
    async (bindingSignal) => {
      if (!args.branch || !args.upstreamName) {
        return undefined
      }
      const signal = boundedSignal(bindingSignal)
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const repo = getLocalRepoForRegisteredWorktree(store, args.worktreePath, worktreePath)
      const gitOptions = getLocalGitOptionsForRepo(store, repo)
      return resolveGitStatusUpstreamRef(
        (gitArgs, cwd, requestSignal) =>
          gitExecFileAsync(gitArgs, {
            cwd,
            signal: requestSignal,
            timeout: UPSTREAM_REF_RESOLUTION_TIMEOUT_MS,
            ...(gitOptions.wslDistro ? { wslDistro: gitOptions.wslDistro } : {})
          }),
        worktreePath,
        args.branch,
        args.upstreamName,
        signal
      )
    }
  )
}
