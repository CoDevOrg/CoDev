import type { GitWorktreeInfo, Repo } from '../shared/types'
import { listWorktrees } from './git/worktree'
import { isFolderRepo } from '../shared/repo-kind'
import { areWorktreePathsEqual } from './ipc/worktree-logic'

type LocalRepoWorktreeListOptions = {
  wslDistro?: string
  signal?: AbortSignal
}

function hasLocalRepoWorktreeListOptions(options: LocalRepoWorktreeListOptions | undefined) {
  return options?.wslDistro !== undefined || options?.signal !== undefined
}

export function isRepoRoot(repos: Repo[], resolvedTarget: string): boolean {
  return repos.some(
    (repo) => !repo.connectionId && areWorktreePathsEqual(repo.path, resolvedTarget)
  )
}

export function createFolderWorktree(repo: Repo): GitWorktreeInfo {
  return {
    path: repo.path,
    head: '',
    branch: '',
    isBare: false,
    // Why: folder mode has no linked worktree graph. Treat the folder itself
    // as the single primary worktree so the rest of Orca's worktree-first UI
    // can keep using one stable workspace identity.
    isMainWorktree: true
  }
}

export async function listRepoWorktrees(
  repo: Repo,
  options?: LocalRepoWorktreeListOptions
): Promise<GitWorktreeInfo[]> {
  if (isFolderRepo(repo)) {
    return [createFolderWorktree(repo)]
  }
  return hasLocalRepoWorktreeListOptions(options)
    ? await listWorktrees(repo.path, options)
    : await listWorktrees(repo.path)
}
