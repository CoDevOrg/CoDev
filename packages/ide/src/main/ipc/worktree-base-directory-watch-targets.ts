import { normalize } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import type { Store } from '../persistence'
import type { FileStat } from '../providers/types'
import type { GlobalSettings, Repo } from '../../shared/types'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { isFolderRepo } from '../../shared/repo-kind'
import {
  getRuntimePathBasename,
  normalizeRuntimePathForComparison
} from '../../shared/cross-platform-path'
import { isWslUncPath } from '../../shared/wsl-paths'
import { computeWorkspaceRoot, getWorktreePathSettings } from './worktree-logic'
import { shouldEmitBoundedWarning } from './bounded-warning-dedupe'
import { resolveWorktreeCommonGitDirectory } from './worktree-common-git-directory'
import type {
  WorktreeBaseRepoWatchConfig,
  WorktreeBaseWatchKind,
  WorktreeBaseWatchTarget
} from './worktree-base-directory-event-filter'

const missingRootWarnings = new Set<string>()
const skippedWslWarnings = new Set<string>()

function normalizeWatchKey(pathValue: string): string {
  return normalizeRuntimePathForComparison(normalize(pathValue))
}

async function canonicalizeExistingPath(pathValue: string): Promise<string> {
  try {
    return await realpath(pathValue)
  } catch {
    return normalize(pathValue)
  }
}

function isDirectoryStat(value: Stats | FileStat | undefined): boolean {
  if (!value) {
    return false
  }
  return 'type' in value ? value.type === 'directory' : value.isDirectory()
}

async function addTarget(
  targets: Map<string, WorktreeBaseWatchTarget>,
  kind: WorktreeBaseWatchKind,
  pathValue: string,
  config: WorktreeBaseRepoWatchConfig
): Promise<void> {
  const watchedPath = await canonicalizeExistingPath(pathValue)
  const key = `${kind}:local:${normalizeWatchKey(watchedPath)}`
  const existing = targets.get(key)
  if (existing) {
    existing.repos.set(config.repoId, config)
    return
  }
  targets.set(key, {
    key,
    kind,
    path: watchedPath,
    repos: new Map([[config.repoId, config]])
  })
}

function getBaseWatchLayout(
  repo: Repo,
  pathSettings: Pick<GlobalSettings, 'workspaceDir' | 'nestWorkspaces'>
): { workspaceRoot: string; nestWorkspaces: boolean } {
  return {
    workspaceRoot: computeWorkspaceRoot(repo.path, pathSettings),
    nestWorkspaces: pathSettings.nestWorkspaces
  }
}

async function maybeAddBaseTarget(
  targets: Map<string, WorktreeBaseWatchTarget>,
  repo: Repo,
  settings: GlobalSettings
): Promise<void> {
  const pathSettings = getWorktreePathSettings(repo, settings)
  const { workspaceRoot, nestWorkspaces } = getBaseWatchLayout(repo, pathSettings)
  // Why: WSL UNC roots are unreliable for native watching; avoid project-level polling.
  if (isWslUncPath(workspaceRoot) || isWslUncPath(repo.path)) {
    const key = `${repo.id}:${workspaceRoot}`
    if (shouldEmitBoundedWarning(skippedWslWarnings, key)) {
      console.warn(
        `[worktree-base-watcher] skipping WSL worktree root watcher for ${workspaceRoot}`
      )
    }
    return
  }

  const config = {
    repoId: repo.id,
    repoName: getRuntimePathBasename(repo.path).replace(/\.git$/, ''),
    nestWorkspaces
  }
  try {
    const rootStat = await stat(workspaceRoot)
    if (isDirectoryStat(rootStat)) {
      await addTarget(targets, 'base', workspaceRoot, config)
    }
  } catch {
    const key = normalizeWatchKey(workspaceRoot)
    if (shouldEmitBoundedWarning(missingRootWarnings, key)) {
      console.warn(`[worktree-base-watcher] worktree root unavailable: ${workspaceRoot}`)
    }
  }

  const commonDir = await resolveWorktreeCommonGitDirectory(repo)
  if (commonDir) {
    await addTarget(targets, 'git-common', commonDir, config)
  }
}

export async function buildWorktreeBaseDirectoryWatchTargets(
  store: Store
): Promise<Map<string, WorktreeBaseWatchTarget>> {
  const settings = store.getSettings()
  const targets = new Map<string, WorktreeBaseWatchTarget>()
  for (const repo of store.getRepos()) {
    if (isFolderRepo(repo)) {
      continue
    }
    const executionHostId = getRepoExecutionHostId(repo)
    if (executionHostId === LOCAL_EXECUTION_HOST_ID) {
      await maybeAddBaseTarget(targets, repo, settings)
    }
  }
  return targets
}

export function clearWorktreeBaseDirectoryWatchTargetWarnings(): void {
  missingRootWarnings.clear()
  skippedWslWarnings.clear()
}
