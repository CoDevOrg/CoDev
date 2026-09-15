/* eslint-disable max-lines */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GitUsernameModule from '../git/git-username'
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { CreateWorktreeResult, GitWorktreeInfo, Repo, Worktree } from '../../shared/types'
import type { ProviderRequestId } from '../../shared/detected-worktree-provider-contract'
import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../../shared/execution-host'
import * as localWorktreeFilesystem from '../local-worktree-filesystem'

const ORIGINAL_PLATFORM = process.platform
const removeWorktreeLinkedPathsMock = vi.hoisted(() => vi.fn())
const findExistingWorktreeSymlinkPathsMock = vi.hoisted(() => vi.fn())

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform
  })
}

const {
  handleMock,
  removeHandlerMock,
  listWorktreesMock,
  parseWorktreeListMock,
  assertWorktreeCleanForRemovalMock,
  addWorktreeMock,
  addSparseWorktreeMock,
  removeWorktreeMock,
  forceDeleteLocalBranchMock,
  resolveLocalGitUsernameMock,
  getBaseRefDefaultMock,
  resolveDefaultBaseRefWithLocalGitMock,
  resolveDefaultBaseRefViaExecMock,
  getDefaultRemoteMock,
  getBranchConflictKindMock,
  getPRForBranchMock,
  getHostedReviewForBranchMock,
  getWorkItemMock,
  getPullRequestPushTargetMock,
  getEffectiveHooksMock,
  createIssueCommandRunnerScriptMock,
  createSetupRunnerScriptMock,
  getEffectiveHooksFromConfigMock,
  getDefaultTabsLaunchMock,
  parseOrcaYamlMock,
  shouldRunSetupForCreateMock,
  buildPosixRunnerScriptMock,
  buildWindowsRunnerScriptMock,
  getSetupRunnerEnvVarsMock,
  resolveSetupRunnerShellMock,
  runHookMock,
  hasHooksFileMock,
  loadHooksMock,
  computeWorktreePathMock,
  ensurePathWithinWorkspaceMock,
  gitExecFileAsyncMock,
  getSshGitProviderMock,
  getSshFilesystemProviderMock,
  getActiveMultiplexerMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  removeHandlerMock: vi.fn(),
  listWorktreesMock: vi.fn(),
  parseWorktreeListMock: vi.fn((output: string) =>
    output
      .trim()
      .split(/\n\s*\n/)
      .filter(Boolean)
      .map((block, index) => {
        const lines = block.split(/\r?\n/)
        const path = lines.find((line) => line.startsWith('worktree '))?.slice(9) ?? ''
        const branch = lines.find((line) => line.startsWith('branch '))?.slice(7) ?? ''
        return { path, branch, head: String(index), isBare: false, isMainWorktree: index === 0 }
      })
  ),
  assertWorktreeCleanForRemovalMock: vi.fn(),
  addWorktreeMock: vi.fn(),
  addSparseWorktreeMock: vi.fn(),
  removeWorktreeMock: vi.fn(),
  forceDeleteLocalBranchMock: vi.fn(),
  resolveLocalGitUsernameMock: vi.fn(),
  getBaseRefDefaultMock: vi.fn(),
  resolveDefaultBaseRefWithLocalGitMock: vi.fn(),
  resolveDefaultBaseRefViaExecMock: vi.fn(),
  getDefaultRemoteMock: vi.fn(),
  getBranchConflictKindMock: vi.fn(),
  getPRForBranchMock: vi.fn(),
  getHostedReviewForBranchMock: vi.fn(),
  getWorkItemMock: vi.fn(),
  getPullRequestPushTargetMock: vi.fn(),
  getEffectiveHooksMock: vi.fn(),
  createIssueCommandRunnerScriptMock: vi.fn(),
  createSetupRunnerScriptMock: vi.fn(),
  getEffectiveHooksFromConfigMock: vi.fn(),
  getDefaultTabsLaunchMock: vi.fn(),
  parseOrcaYamlMock: vi.fn(),
  shouldRunSetupForCreateMock: vi.fn(),
  buildPosixRunnerScriptMock: vi.fn(),
  buildWindowsRunnerScriptMock: vi.fn(),
  getSetupRunnerEnvVarsMock: vi.fn(),
  resolveSetupRunnerShellMock: vi.fn(),
  runHookMock: vi.fn(),
  hasHooksFileMock: vi.fn(),
  loadHooksMock: vi.fn(),
  computeWorktreePathMock: vi.fn(),
  ensurePathWithinWorkspaceMock: vi.fn(),
  gitExecFileAsyncMock: vi.fn(),
  getSshGitProviderMock: vi.fn(),
  getSshFilesystemProviderMock: vi.fn(),
  getActiveMultiplexerMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
    removeHandler: removeHandlerMock
  }
}))

vi.mock('../git/worktree', () => ({
  listWorktrees: listWorktreesMock,
  listWorktreesStrict: listWorktreesMock,
  parseWorktreeList: parseWorktreeListMock,
  assertWorktreeCleanForRemoval: assertWorktreeCleanForRemovalMock,
  addWorktree: addWorktreeMock,
  addSparseWorktree: addSparseWorktreeMock,
  removeWorktree: removeWorktreeMock,
  forceDeleteLocalBranch: forceDeleteLocalBranchMock
}))

vi.mock('../git/runner', () => ({
  gitExecFileAsync: gitExecFileAsyncMock,
  gitExecFileSync: vi.fn()
}))

vi.mock('../git/repo', () => ({
  getBaseRefDefault: getBaseRefDefaultMock,
  resolveDefaultBaseRefWithLocalGit: resolveDefaultBaseRefWithLocalGitMock,
  resolveDefaultBaseRefViaExec: resolveDefaultBaseRefViaExecMock,
  getDefaultRemote: getDefaultRemoteMock,
  getBranchConflictKind: getBranchConflictKindMock
}))

vi.mock('../git/git-username', async () => {
  const actual = await vi.importActual<typeof GitUsernameModule>('../git/git-username')
  return { ...actual, resolveLocalGitUsername: resolveLocalGitUsernameMock }
})

vi.mock('../github/client', () => ({
  getPRForBranch: getPRForBranchMock,
  getWorkItem: getWorkItemMock,
  getPullRequestPushTarget: getPullRequestPushTargetMock
}))

vi.mock('../source-control/hosted-review', () => ({
  getHostedReviewForBranch: getHostedReviewForBranchMock
}))

vi.mock('./worktree-symlinks', () => ({
  createWorktreeCopiedPaths: vi.fn(),
  createWorktreeLinkedPaths: vi.fn(),
  findExistingWorktreeSymlinkPaths: findExistingWorktreeSymlinkPathsMock,
  removeWorktreeLinkedPaths: removeWorktreeLinkedPathsMock
}))

vi.mock('../hooks', () => ({
  buildPosixRunnerScript: buildPosixRunnerScriptMock,
  buildWindowsRunnerScript: buildWindowsRunnerScriptMock,
  createIssueCommandRunnerScript: createIssueCommandRunnerScriptMock,
  createSetupRunnerScript: createSetupRunnerScriptMock,
  getEffectiveHooks: getEffectiveHooksMock,
  getEffectiveHooksFromConfig: getEffectiveHooksFromConfigMock,
  getDefaultTabsLaunch: getDefaultTabsLaunchMock,
  getSetupRunnerEnvVars: getSetupRunnerEnvVarsMock,
  loadHooks: loadHooksMock,
  parseOrcaYaml: parseOrcaYamlMock,
  resolveSetupRunnerShell: resolveSetupRunnerShellMock,
  runHook: runHookMock,
  hasHooksFile: hasHooksFileMock,
  shouldRunSetupForCreate: shouldRunSetupForCreateMock
}))

vi.mock('./worktree-logic', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    computeWorktreePath: computeWorktreePathMock,
    ensurePathWithinWorkspace: ensurePathWithinWorkspaceMock
  }
})

const { deleteWorktreeHistoryDirMock } = vi.hoisted(() => ({
  deleteWorktreeHistoryDirMock: vi.fn()
}))

vi.mock('../terminal-history-deletion', () => ({
  deleteWorktreeHistoryDir: deleteWorktreeHistoryDirMock
}))

const { advertisedUrlWatcherForgetWorktreeMock } = vi.hoisted(() => ({
  advertisedUrlWatcherForgetWorktreeMock: vi.fn()
}))

vi.mock('../ports/advertised-url-watcher', () => ({
  advertisedUrlWatcher: {
    forgetWorktree: advertisedUrlWatcherForgetWorktreeMock
  }
}))

const {
  killAllProcessesForWorktreeMock,
  clearProviderPtyStateMock,
  getLocalPtyProviderMock,
  getSshPtyProviderMock
} = vi.hoisted(() => ({
  killAllProcessesForWorktreeMock: vi.fn(),
  clearProviderPtyStateMock: vi.fn(),
  getLocalPtyProviderMock: vi.fn(),
  getSshPtyProviderMock: vi.fn()
}))

vi.mock('../runtime/worktree-teardown', () => ({
  killAllProcessesForWorktree: killAllProcessesForWorktreeMock
}))

vi.mock('./pty', () => ({
  clearProviderPtyState: clearProviderPtyStateMock,
  getLocalPtyProvider: getLocalPtyProviderMock,
  getSshPtyProvider: getSshPtyProviderMock
}))

import {
  __resetSshWorktreeCreateFetchCacheForTests,
  notifyWorktreesChanged
} from './worktree-remote'
import {
  invalidateAuthorizedRootsCache,
  registerWorktreeRootsForRepo,
  resolveRegisteredWorktreePath
} from './filesystem-auth'
import { _resetTracerForTests, setActiveSink } from '../observability/tracer'
import type { RedactableSpan } from '../observability/redactor'
import {
  reviewHeadRemoteRefComponent,
  REVIEW_HEAD_FETCH_TIMEOUT_MS
} from '../../shared/review-head-tracking-ref'

// Why: durable review-head refs are scoped by remote identity (name + URL hash).
const ORIGIN_REMOTE_URL = 'git@github.com:org/repo.git'
const ORIGIN_HEAD_COMPONENT = reviewHeadRemoteRefComponent('origin', ORIGIN_REMOTE_URL)
import {
  DETECTED_WORKTREE_PROVIDER_TIMEOUT_MS,
  LINEAGE_HYDRATION_TIMEOUT_MS,
  __getDetectedWorktreeScanCacheStatsForTests,
  __resetDetectedWorktreeScanCacheForTests,
  registerWorktreeHandlers
} from './worktrees'
import { clearConfiguredWorktreeSharedDirectoriesCacheForTests } from '../git/worktree-shared-directories'
type HandlerMap = Record<string, (_event: unknown, args: unknown) => unknown>

describe('registerWorktreeHandlers', () => {
  const handlers: HandlerMap = {}
  const mainWindow = {
    isDestroyed: () => false,
    webContents: {
      send: vi.fn()
    }
  }
  const ipcEvent = { sender: { id: 1 } }
  const store = {
    getRepos: vi.fn(),
    getRepo: vi.fn(),
    getProjects: vi.fn(),
    getSparsePresets: vi.fn(),
    getSettings: vi.fn(),
    getWorktreeMeta: vi.fn(),
    getAllWorktreeMeta: vi.fn(),
    setWorktreeMeta: vi.fn(),
    getProjectHostSetups: vi.fn(),
    removeWorktreeMeta: vi.fn(),
    removeWorkspaceSessionStateForWorktree: vi.fn(),
    getAllWorktreeLineage: vi.fn(),
    removeWorktreeLineage: vi.fn(),
    getAllWorkspaceLineage: vi.fn(),
    getFolderWorkspaces: vi.fn(),
    getProjectGroups: vi.fn()
  }
  let runtimeStub: {
    resolveRemoteTrackingBase: ReturnType<typeof vi.fn>
    hasRemoteTrackingRef: ReturnType<typeof vi.fn>
    getOrStartRemoteTrackingBaseRefresh: ReturnType<typeof vi.fn>
    getOrStartRemoteFetch: ReturnType<typeof vi.fn>
    fetchRemoteWithCache: ReturnType<typeof vi.fn>
    emitWorktreeBaseStatus: ReturnType<typeof vi.fn>
    recordOptimisticReconcileToken: ReturnType<typeof vi.fn>
    reconcileWorktreeBaseStatus: ReturnType<typeof vi.fn>
    clearOptimisticReconcileToken: ReturnType<typeof vi.fn>
    createTerminal: ReturnType<typeof vi.fn>
    splitTerminal: ReturnType<typeof vi.fn>
    notifyWorktreesChangedForRemoteClients: ReturnType<typeof vi.fn>
    closeFileWatchersForRemoval: ReturnType<typeof vi.fn>
    acquireFileWatcherRemoval: ReturnType<typeof vi.fn>
    hydrateInferredWorktreeLineage: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    setPlatform(ORIGINAL_PLATFORM)
    clearConfiguredWorktreeSharedDirectoriesCacheForTests()
    __resetSshWorktreeCreateFetchCacheForTests()
    __resetDetectedWorktreeScanCacheForTests()
    resetSshProviderAuthorities()
    invalidateAuthorizedRootsCache()
    for (const m of [
      handleMock,
      removeHandlerMock,
      listWorktreesMock,
      assertWorktreeCleanForRemovalMock,
      addWorktreeMock,
      addSparseWorktreeMock,
      removeWorktreeMock,
      forceDeleteLocalBranchMock,
      resolveLocalGitUsernameMock,
      getBaseRefDefaultMock,
      resolveDefaultBaseRefWithLocalGitMock,
      resolveDefaultBaseRefViaExecMock,
      getDefaultRemoteMock,
      getBranchConflictKindMock,
      getPRForBranchMock,
      getHostedReviewForBranchMock,
      getWorkItemMock,
      getPullRequestPushTargetMock,
      getEffectiveHooksMock,
      getEffectiveHooksFromConfigMock,
      getDefaultTabsLaunchMock,
      parseOrcaYamlMock,
      createIssueCommandRunnerScriptMock,
      createSetupRunnerScriptMock,
      buildPosixRunnerScriptMock,
      buildWindowsRunnerScriptMock,
      getSetupRunnerEnvVarsMock,
      resolveSetupRunnerShellMock,
      shouldRunSetupForCreateMock,
      runHookMock,
      hasHooksFileMock,
      loadHooksMock,
      computeWorktreePathMock,
      ensurePathWithinWorkspaceMock,
      gitExecFileAsyncMock,
      getSshGitProviderMock,
      getSshFilesystemProviderMock,
      getActiveMultiplexerMock,
      mainWindow.webContents.send,
      store.getRepos,
      store.getRepo,
      store.getProjects,
      store.getSparsePresets,
      store.getSettings,
      store.getWorktreeMeta,
      store.getAllWorktreeMeta,
      store.setWorktreeMeta,
      store.getProjectHostSetups,
      store.removeWorktreeMeta,
      store.removeWorkspaceSessionStateForWorktree,
      store.getAllWorktreeLineage,
      store.removeWorktreeLineage,
      store.getAllWorkspaceLineage,
      store.getFolderWorkspaces,
      store.getProjectGroups,
      killAllProcessesForWorktreeMock,
      clearProviderPtyStateMock,
      getLocalPtyProviderMock,
      getSshPtyProviderMock,
      deleteWorktreeHistoryDirMock,
      advertisedUrlWatcherForgetWorktreeMock,
      findExistingWorktreeSymlinkPathsMock,
      removeWorktreeLinkedPathsMock
    ]) {
      m.mockReset()
    }
    killAllProcessesForWorktreeMock.mockResolvedValue({
      runtimeStopped: 0,
      providerStopped: 0,
      registryStopped: 0
    })
    assertWorktreeCleanForRemovalMock.mockResolvedValue(undefined)
    findExistingWorktreeSymlinkPathsMock.mockResolvedValue([])
    getLocalPtyProviderMock.mockReturnValue({} as never)
    getSshPtyProviderMock.mockReturnValue({} as never)

    for (const key of Object.keys(handlers)) {
      delete handlers[key]
    }

    handleMock.mockImplementation((channel, handler) => {
      handlers[channel] = handler
    })

    const repo = {
      id: 'repo-1',
      path: '/workspace/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0
    }
    store.getRepos.mockReturnValue([repo])
    store.getRepo.mockReturnValue({ ...repo, worktreeBaseRef: null })
    store.getProjects.mockReturnValue([])
    store.getSparsePresets.mockReturnValue([])
    store.getSettings.mockReturnValue({
      branchPrefix: 'none',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      workspaceDir: '/workspace'
    })
    store.getWorktreeMeta.mockReturnValue(undefined)
    store.getAllWorktreeMeta.mockReturnValue({})
    store.setWorktreeMeta.mockReturnValue({})
    store.getProjectHostSetups.mockReturnValue([
      {
        id: 'repo-1',
        projectId: 'repo:repo-1',
        hostId: 'local',
        repoId: 'repo-1',
        path: '/workspace/repo',
        displayName: 'repo',
        setupState: 'ready',
        setupMethod: 'legacy-repo',
        createdAt: 0,
        updatedAt: 0
      }
    ])
    store.getAllWorktreeLineage.mockReturnValue({})
    store.getAllWorkspaceLineage.mockReturnValue({})
    store.getFolderWorkspaces.mockReturnValue([])
    store.getProjectGroups.mockReturnValue([])
    resolveLocalGitUsernameMock.mockResolvedValue('')
    getBaseRefDefaultMock.mockResolvedValue('origin/main')
    resolveDefaultBaseRefWithLocalGitMock.mockResolvedValue('origin/main')
    resolveDefaultBaseRefViaExecMock.mockResolvedValue('origin/main')
    getDefaultRemoteMock.mockResolvedValue('origin')
    getBranchConflictKindMock.mockResolvedValue(null)
    getPRForBranchMock.mockResolvedValue(null)
    getHostedReviewForBranchMock.mockResolvedValue(null)
    getWorkItemMock.mockResolvedValue(null)
    getPullRequestPushTargetMock.mockResolvedValue(null)
    // Why: createLocalWorktree can still hit the legacy git fetch fallback here; resolve so catch/then chains don't trip on undefined.
    gitExecFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })
    getEffectiveHooksMock.mockReturnValue(null)
    getEffectiveHooksFromConfigMock.mockImplementation(() => getEffectiveHooksMock())
    getDefaultTabsLaunchMock.mockReturnValue(undefined)
    parseOrcaYamlMock.mockReturnValue(null)
    shouldRunSetupForCreateMock.mockReturnValue(false)
    buildPosixRunnerScriptMock.mockImplementation(
      (script: string) => `#!/usr/bin/env bash\nset -e\n${script.replace(/\r\n/g, '\n')}\n`
    )
    buildWindowsRunnerScriptMock.mockImplementation((script: string) => script)
    resolveSetupRunnerShellMock.mockReturnValue(undefined)
    getSetupRunnerEnvVarsMock.mockImplementation(
      (repoArg: { path: string }, worktreePath: string) => ({
        ORCA_ROOT_PATH: repoArg.path,
        ORCA_WORKTREE_PATH: worktreePath,
        ORCA_WORKSPACE_NAME: worktreePath.split('/').at(-1) ?? '',
        CONDUCTOR_ROOT_PATH: repoArg.path,
        GHOSTX_ROOT_PATH: repoArg.path
      })
    )
    createSetupRunnerScriptMock.mockReturnValue({
      runnerScriptPath: '/workspace/repo/.git/orca/setup-runner.sh',
      envVars: {
        ORCA_ROOT_PATH: '/workspace/repo',
        ORCA_WORKTREE_PATH: '/workspace/improve-dashboard'
      }
    })
    createIssueCommandRunnerScriptMock.mockReturnValue({
      runnerScriptPath: '/workspace/repo/.git/orca/issue-command-runner.sh',
      envVars: {
        ORCA_ROOT_PATH: '/workspace/repo',
        ORCA_WORKTREE_PATH: '/workspace/improve-dashboard'
      }
    })
    computeWorktreePathMock.mockImplementation(
      (
        sanitizedName: string,
        repoPath: string,
        settings: { nestWorkspaces: boolean; workspaceDir: string }
      ) => {
        if (settings.nestWorkspaces) {
          const repoName =
            repoPath
              .split(/[\\/]/)
              .at(-1)
              ?.replace(/\.git$/, '') ?? 'repo'
          return `${settings.workspaceDir}/${repoName}/${sanitizedName}`
        }
        return `${settings.workspaceDir}/${sanitizedName}`
      }
    )
    ensurePathWithinWorkspaceMock.mockImplementation((targetPath: string) => targetPath)
    listWorktreesMock.mockResolvedValue([])
    forceDeleteLocalBranchMock.mockResolvedValue(undefined)

    // Why: minimal stub keeps these tests on create-flow semantics; full fetchRemoteWithCache behavior is covered by fetch-remote-cache.test.ts.
    runtimeStub = {
      resolveRemoteTrackingBase: vi.fn().mockResolvedValue(null),
      hasRemoteTrackingRef: vi.fn().mockResolvedValue(false),
      getOrStartRemoteTrackingBaseRefresh: vi.fn().mockResolvedValue({ ok: true }),
      getOrStartRemoteFetch: vi.fn().mockResolvedValue({ ok: true }),
      fetchRemoteWithCache: vi.fn().mockResolvedValue(undefined),
      emitWorktreeBaseStatus: vi.fn(),
      recordOptimisticReconcileToken: vi.fn().mockReturnValue('token-1'),
      reconcileWorktreeBaseStatus: vi.fn(),
      clearOptimisticReconcileToken: vi.fn(),
      createTerminal: vi.fn().mockResolvedValue({
        handle: 'term-startup',
        worktreeId: 'repo-1::/workspace/improve-dashboard',
        title: null,
        surface: 'visible'
      }),
      splitTerminal: vi.fn().mockResolvedValue({
        handle: 'term-setup',
        tabId: 'tab-startup',
        paneRuntimeId: -1
      }),
      notifyWorktreesChangedForRemoteClients: vi.fn(),
      closeFileWatchersForRemoval: vi.fn().mockResolvedValue(undefined),
      acquireFileWatcherRemoval: vi.fn(),
      hydrateInferredWorktreeLineage: vi.fn().mockResolvedValue(undefined)
    }
    runtimeStub.acquireFileWatcherRemoval.mockImplementation(
      async (worktreePath: string, connectionId?: string) => {
        await (
          runtimeStub.closeFileWatchersForRemoval as (
            worktreePath: string,
            connectionId?: string
          ) => Promise<void>
        )(worktreePath, connectionId)
        return {
          finish: vi.fn().mockResolvedValue(undefined)
        }
      }
    )
    registerWorktreeHandlers(mainWindow as never, store as never, runtimeStub as never)
  })

  it('clears the branch rename failure-output handler before re-registering IPC handlers', () => {
    expect(removeHandlerMock).toHaveBeenCalledWith('worktrees:getBranchRenameFailureOutput')
    expect(handlers['worktrees:getBranchRenameFailureOutput']).toBeDefined()
  })

  it('persistSortOrder only reorders existing worktrees and never mints meta for a stale id', () => {
    const liveId = 'repo-1::/workspace/repo'
    const staleId = 'removed-repo::/workspace/gone'
    // Only the live worktree has meta; the stale id (e.g. a removed repo the
    // renderer still lists) has none and must be skipped, not created.
    store.getWorktreeMeta.mockImplementation((id: string) =>
      id === liveId ? ({ instanceId: 'x' } as never) : undefined
    )

    handlers['worktrees:persistSortOrder'](null, { orderedIds: [liveId, staleId] })

    const orderedTargets = store.setWorktreeMeta.mock.calls.map((call) => call[0])
    expect(orderedTargets).toContain(liveId)
    expect(orderedTargets).not.toContain(staleId)
  })

  it('prefetches the local default create base through the runtime refresh cache', async () => {
    const repo = {
      id: 'repo-1',
      path: '/workspace/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      worktreeBaseRef: 'origin/master'
    }
    const remoteBase = {
      remote: 'origin',
      branch: 'main',
      ref: 'refs/remotes/origin/main',
      base: 'origin/main'
    }
    store.getRepo.mockReturnValue(repo)
    runtimeStub.resolveRemoteTrackingBase.mockImplementation(async (_repoPath, baseBranch) =>
      baseBranch === 'origin/main' ? remoteBase : null
    )
    runtimeStub.hasRemoteTrackingRef.mockResolvedValue(true)

    await handlers['worktrees:prefetchCreateBase'](null, { repoId: 'repo-1' })

    expect(getBaseRefDefaultMock).toHaveBeenCalledWith('/workspace/repo')
    expect(runtimeStub.resolveRemoteTrackingBase).toHaveBeenCalledWith(
      '/workspace/repo',
      'origin/master'
    )
    expect(runtimeStub.resolveRemoteTrackingBase).toHaveBeenCalledWith(
      '/workspace/repo',
      'origin/main'
    )
    expect(runtimeStub.getOrStartRemoteTrackingBaseRefresh).toHaveBeenCalledWith(
      '/workspace/repo',
      remoteBase
    )
    expect(addWorktreeMock).not.toHaveBeenCalled()
  })

  it('uses the runtime remote fetch cache when prefetching a local branch base', async () => {
    runtimeStub.resolveRemoteTrackingBase.mockResolvedValue(null)

    await handlers['worktrees:prefetchCreateBase'](null, {
      repoId: 'repo-1',
      baseBranch: 'main'
    })

    expect(runtimeStub.fetchRemoteWithCache).toHaveBeenCalledWith('/workspace/repo', 'origin')
    expect(addWorktreeMock).not.toHaveBeenCalled()
  })

  it('prefetches origin for local branch bases containing slashes', async () => {
    runtimeStub.resolveRemoteTrackingBase.mockResolvedValue(null)

    await handlers['worktrees:prefetchCreateBase'](null, {
      repoId: 'repo-1',
      baseBranch: 'Jinwoo-H/vm-improve-2'
    })

    expect(runtimeStub.fetchRemoteWithCache).toHaveBeenCalledWith('/workspace/repo', 'origin')
    expect(runtimeStub.fetchRemoteWithCache).not.toHaveBeenCalledWith('/workspace/repo', 'Jinwoo-H')
    expect(addWorktreeMock).not.toHaveBeenCalled()
  })

  it('does not prefetch the whole remote for an existing commit SHA base', async () => {
    const sha = 'a'.repeat(40)

    await handlers['worktrees:prefetchCreateBase'](null, {
      repoId: 'repo-1',
      baseBranch: sha
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`],
      { cwd: '/workspace/repo' }
    )
    expect(runtimeStub.resolveRemoteTrackingBase).not.toHaveBeenCalled()
    expect(runtimeStub.fetchRemoteWithCache).not.toHaveBeenCalled()
    expect(addWorktreeMock).not.toHaveBeenCalled()
  })

  it('skips the broad remote fetch when creating from an existing commit SHA base', async () => {
    const sha = 'a'.repeat(40)
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/pr-title',
        head: sha,
        branch: 'refs/heads/feature/fix',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'pr-title',
      baseBranch: sha,
      branchNameOverride: 'feature/fix'
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`],
      { cwd: '/workspace/repo' }
    )
    expect(runtimeStub.fetchRemoteWithCache).not.toHaveBeenCalled()
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/pr-title',
      'feature/fix',
      sha,
      false
    )
  })

  it('keeps the broad remote fetch fallback when a commit SHA base is missing locally', async () => {
    const sha = 'b'.repeat(40)
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args.includes(`${sha}^{commit}`)) {
        throw new Error('missing object')
      }
      return { stdout: '', stderr: '' }
    })
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/pr-title',
        head: sha,
        branch: 'refs/heads/feature/fix',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'pr-title',
      baseBranch: sha,
      branchNameOverride: 'feature/fix'
    })

    expect(runtimeStub.fetchRemoteWithCache).toHaveBeenCalledWith('/workspace/repo', 'origin')
    expect(addWorktreeMock).toHaveBeenCalled()
  })

  it('fetches origin when creating from a local branch base containing slashes', async () => {
    runtimeStub.resolveRemoteTrackingBase.mockResolvedValue(null)
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/slash-base',
        head: 'created-sha',
        branch: 'refs/heads/slash-base',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'slash-base',
      baseBranch: 'Jinwoo-H/vm-improve-2',
      branchNameOverride: 'slash-base'
    })

    expect(runtimeStub.fetchRemoteWithCache).toHaveBeenCalledWith('/workspace/repo', 'origin')
    expect(runtimeStub.fetchRemoteWithCache).not.toHaveBeenCalledWith('/workspace/repo', 'Jinwoo-H')
    expect(addWorktreeMock).toHaveBeenCalled()
  })

  function mockKnownFeatureWorktree(
    path = '/workspace/feature-wt',
    repoPath = '/workspace/repo'
  ): GitWorktreeInfo[] {
    const worktrees: GitWorktreeInfo[] = [
      {
        path: repoPath,
        head: 'main',
        branch: 'main',
        isBare: false,
        isMainWorktree: true
      },
      {
        path,
        head: 'feature',
        branch: 'feature',
        isBare: false,
        isMainWorktree: false
      }
    ]
    listWorktreesMock.mockResolvedValue(worktrees)
    return worktrees
  }

  function makeWorktreeMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      displayName: '',
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0,
      ...overrides
    }
  }

  function mockSelectedWslProjectRuntime(): void {
    setPlatform('win32')
    store.getProjects.mockReturnValue([
      {
        id: 'project-1',
        displayName: 'repo',
        badgeColor: '#000',
        sourceRepoIds: ['repo-1'],
        localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' },
        createdAt: 0,
        updatedAt: 0
      }
    ])
  }

  it('strips Orca provenance fields from renderer metadata updates', () => {
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => meta)

    const result = handlers['worktrees:updateMeta'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt',
      updates: {
        comment: 'keep me',
        isPinned: true,
        orcaCreatedAt: 123,
        orcaCreationSource: 'desktop',
        orcaCreationWorkspaceLayout: { path: '/workspace', nestWorkspaces: false }
      }
    })

    expect(store.setWorktreeMeta).toHaveBeenCalledWith('repo-1::/workspace/feature-wt', {
      comment: 'keep me',
      isPinned: true
    })
    expect(result).toMatchObject({ comment: 'keep me', isPinned: true })
  })

  it('pushes a remote-client invalidation for renames but not read-state updates', () => {
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => meta)

    handlers['worktrees:updateMeta'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt',
      updates: { isUnread: false }
    })
    // Why: per-click isUnread writes must stay event-free (PR #209), while a rename must reach paired remote clients that no longer poll for titles.
    expect(runtimeStub.notifyWorktreesChangedForRemoteClients).not.toHaveBeenCalled()

    handlers['worktrees:updateMeta'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt',
      updates: { displayName: 'Renamed workspace' }
    })
    expect(runtimeStub.notifyWorktreesChangedForRemoteClients).toHaveBeenCalledWith('repo-1')
  })

  it('does not trust renderer-authored automation provenance during local create', async () => {
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => meta)
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard',
        head: 'abc123',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      automationProvenance: {
        kind: 'created-by-automation',
        automationId: 'automation-1',
        automationNameSnapshot: 'Forged',
        automationRunId: 'run-1',
        automationRunTitleSnapshot: 'Forged run',
        createdAt: 123,
        executionTargetType: 'local',
        executionTargetId: 'local',
        projectId: 'repo-1'
      }
    })

    const persistedMeta = store.setWorktreeMeta.mock.calls.find(
      ([worktreeId]) => worktreeId === 'repo-1::/workspace/improve-dashboard'
    )?.[1]
    expect(persistedMeta).toBeDefined()
    expect(persistedMeta).not.toHaveProperty('automationProvenance')
  })

  it('auto-suffixes the branch name when the first choice collides with a remote branch', async () => {
    // Why: new-workspace flow should silently try improve-dashboard-2, -3, … rather than failing back to the name picker.
    getBranchConflictKindMock.mockImplementation(async (_repoPath: string, branch: string) =>
      branch === 'improve-dashboard' ? 'remote' : null
    )
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard-2',
        head: 'abc123',
        branch: 'improve-dashboard-2',
        isBare: false,
        isMainWorktree: false
      }
    ])

    const result = (await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard'
    })) as CreateWorktreeResult

    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/improve-dashboard-2',
      'improve-dashboard-2',
      'origin/main',
      false
    )
    expect(result).toMatchObject({
      worktree: expect.objectContaining({
        path: '/workspace/improve-dashboard-2',
        branch: 'improve-dashboard-2'
      })
    })
  })

  it('keeps an emoji-only display name while using safe branch and path names', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/rocket',
        head: 'abc123',
        branch: 'rocket',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: '🚀'
    })

    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/rocket',
      'rocket',
      'origin/main',
      false
    )
    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/rocket',
      expect.objectContaining({ displayName: '🚀' })
    )
  })

  it('uses a repo-specific worktree base path when creating local worktrees', async () => {
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: '/workspace/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      worktreeBaseRef: null,
      worktreeBasePath: '../worktrees'
    })
    listWorktreesMock.mockResolvedValue([
      {
        path: '../worktrees/feature',
        head: 'abc123',
        branch: 'feature',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'feature'
    })

    expect(computeWorktreePathMock).toHaveBeenCalledWith('feature', '/workspace/repo', {
      nestWorkspaces: false,
      workspaceDir: '../worktrees'
    })
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '../worktrees/feature',
      'feature',
      'origin/main',
      false
    )
    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::../worktrees/feature',
      expect.objectContaining({
        orcaCreationWorkspaceLayout: { path: '../worktrees', nestWorkspaces: false }
      })
    )
  })

  it('registers local worktree roots immediately after create', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/repo',
        head: 'base',
        branch: 'refs/heads/main',
        isBare: false,
        isMainWorktree: true
      },
      {
        path: '/workspace/improve-dashboard',
        head: 'abc123',
        branch: 'refs/heads/improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard'
    })

    const listWorktreesCallsAfterCreate = listWorktreesMock.mock.calls.length
    await expect(
      resolveRegisteredWorktreePath('/workspace/improve-dashboard', store as never)
    ).resolves.toBe(resolve('/workspace/improve-dashboard'))
    expect(listWorktreesMock).toHaveBeenCalledTimes(listWorktreesCallsAfterCreate)
  })

  it('uses branchNameOverride for the git branch while keeping the sanitized worktree path', async () => {
    store.getSettings.mockReturnValue({
      branchPrefix: 'git-username',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      workspaceDir: '/workspace'
    })
    resolveLocalGitUsernameMock.mockResolvedValue('unused-user')
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/feature-something',
        head: 'abc123',
        branch: 'feature/something',
        isBare: false,
        isMainWorktree: false
      }
    ])

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'feature/something',
      branchNameOverride: 'feature/something'
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['check-ref-format', '--branch', 'feature/something'],
      { cwd: '/workspace/repo' }
    )
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/feature-something',
      'feature/something',
      'origin/main',
      false
    )
    expect(resolveLocalGitUsernameMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      worktree: expect.objectContaining({
        path: '/workspace/feature-something',
        branch: 'feature/something'
      })
    })
  })

  it('creates an additional workspace for folder-mode repos without git worktree add', async () => {
    const repo = {
      id: 'repo-folder',
      path: '/workspace/folder',
      displayName: 'folder',
      badgeColor: '#000',
      addedAt: 0,
      kind: 'folder' as const
    }
    store.getRepo.mockReturnValue(repo)
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => ({
      displayName: '',
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0,
      ...meta
    }))

    const result = (await handlers['worktrees:create'](null, {
      repoId: 'repo-folder',
      name: 'folder-session',
      createdWithAgent: 'codex'
    })) as { worktree: { id: string } }

    expect(addWorktreeMock).not.toHaveBeenCalled()
    expect(result.worktree).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^repo-folder::\/workspace\/folder::workspace:[0-9a-f-]{36}$/),
        repoId: 'repo-folder',
        path: '/workspace/folder',
        displayName: 'folder-session',
        instanceId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        createdWithAgent: 'codex'
      })
    )
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('worktrees:changed', {
      repoId: 'repo-folder'
    })
  })

  it('spawns a startup terminal and setup terminal after local worktree registration', async () => {
    addWorktreeMock.mockResolvedValue({})
    listWorktreesMock.mockResolvedValueOnce([
      {
        path: '/workspace/improve-dashboard',
        head: 'def',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    loadHooksMock.mockReturnValue({ scripts: { setup: 'pnpm install' } })
    getEffectiveHooksMock.mockReturnValue({ scripts: { setup: 'pnpm install' } })
    getEffectiveHooksFromConfigMock.mockReturnValue({ scripts: { setup: 'pnpm install' } })
    shouldRunSetupForCreateMock.mockReturnValue(true)

    const result = (await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      createdWithAgent: 'claude',
      startup: {
        command: 'claude --prefill test',
        env: { ORCA_AGENT_MODE: 'direct' },
        viewMode: 'chat',
        telemetry: {
          agent_kind: 'claude',
          launch_source: 'new_workspace_composer',
          request_kind: 'new'
        }
      }
    })) as {
      setup?: unknown
      startupTerminal?: { spawned: boolean; surface?: string }
      timing?: { phases: { phase: string }[] }
    }

    expect(runtimeStub.createTerminal).toHaveBeenNthCalledWith(
      1,
      'id:repo-1::/workspace/improve-dashboard',
      {
        claudeAgentTeamsSourceCommand: 'claude --prefill test',
        command: 'claude --prefill test',
        env: { ORCA_AGENT_MODE: 'direct' },
        launchAgent: 'claude',
        viewMode: 'chat',
        startupCommandDelivery: undefined,
        telemetry: {
          agent_kind: 'claude',
          launch_source: 'new_workspace_composer',
          request_kind: 'new'
        },
        activate: true
      }
    )
    expect(runtimeStub.createTerminal).toHaveBeenNthCalledWith(
      2,
      'id:repo-1::/workspace/improve-dashboard',
      {
        title: 'Setup',
        command: expect.stringContaining('bash /workspace/repo/.git/orca/setup-runner.sh'),
        env: {
          ORCA_ROOT_PATH: '/workspace/repo',
          ORCA_WORKTREE_PATH: '/workspace/improve-dashboard'
        },
        activate: false
      }
    )
    const startupCreateCall = runtimeStub.createTerminal.mock.calls[0]
    const setupCreateCall = runtimeStub.createTerminal.mock.calls[1]
    if (!startupCreateCall || !setupCreateCall) {
      throw new Error('expected startup and setup terminal calls')
    }
    const startupCommand = (startupCreateCall[1] as { command: string }).command
    const setupCommand = (setupCreateCall[1] as { command: string }).command
    expect(startupCommand).toBe('claude --prefill test')
    expect(setupCommand).toBe('bash /workspace/repo/.git/orca/setup-runner.sh')
    expect(result.setup).toBeUndefined()
    expect(result.startupTerminal).toEqual({ spawned: true, surface: 'visible' })
    expect(result.timing?.phases.map((phase) => phase.phase)).toEqual(
      expect.arrayContaining([
        'git_worktree_add',
        'list_created_worktree',
        'resolve_worktreeinclude',
        'prepare_setup',
        'spawn_startup_terminal'
      ])
    )
  })

  it('returns the wrapped setup command when startup spawned but setup creation failed', async () => {
    addWorktreeMock.mockResolvedValue({})
    listWorktreesMock.mockResolvedValueOnce([
      {
        path: '/workspace/improve-dashboard',
        head: 'def',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    loadHooksMock.mockReturnValue({ scripts: { setup: 'pnpm install' } })
    getEffectiveHooksMock.mockReturnValue({ scripts: { setup: 'pnpm install' } })
    getEffectiveHooksFromConfigMock.mockReturnValue({ scripts: { setup: 'pnpm install' } })
    shouldRunSetupForCreateMock.mockReturnValue(true)
    createSetupRunnerScriptMock.mockReturnValueOnce({
      runnerScriptPath: 'C:\\workspace\\repo\\.git\\orca\\setup-runner.sh',
      shell: { family: 'posix', executable: 'wsl.exe' },
      envVars: {
        ORCA_ROOT_PATH: 'C:\\workspace\\repo',
        ORCA_WORKTREE_PATH: 'C:\\workspace\\improve-dashboard'
      },
      waitForAgentStartup: true
    })
    runtimeStub.createTerminal
      .mockResolvedValueOnce({ handle: 'term-startup', surface: 'visible' })
      .mockRejectedValueOnce(new Error('setup creation failed'))

    const result = (await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      createdWithAgent: 'claude',
      startup: {
        command: 'claude --prefill test',
        env: { ORCA_AGENT_MODE: 'direct' },
        telemetry: {
          agent_kind: 'claude',
          launch_source: 'new_workspace_composer',
          request_kind: 'new'
        }
      }
    })) as { setup?: { command?: string; runnerScriptPath: string } }

    expect(result.setup).toEqual(
      expect.objectContaining({
        runnerScriptPath: 'C:\\workspace\\repo\\.git\\orca\\setup-runner.sh',
        command: expect.stringContaining('bash /mnt/c/workspace/repo/.git/orca/setup-runner.sh')
      })
    )
    expect(result.setup?.command).toContain('printf')
  })

  it('checks out a selected existing local branch exactly', async () => {
    listWorktreesMock
      .mockResolvedValueOnce([
        {
          path: '/workspace/repo',
          head: 'main',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        }
      ])
      .mockResolvedValueOnce([
        {
          path: '/workspace/repo',
          head: 'main',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        },
        {
          path: '/workspace/fix-bug-0',
          head: 'abc123',
          branch: 'refs/heads/fix/bug-0',
          isBare: false,
          isMainWorktree: false
        }
      ])

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'fix/bug-0',
      baseBranch: 'fix/bug-0',
      branchNameOverride: 'fix/bug-0'
    })

    expect(getBranchConflictKindMock).not.toHaveBeenCalled()
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/fix-bug-0',
      'fix/bug-0',
      'fix/bug-0',
      false,
      false,
      { checkoutExistingBranch: true }
    )
    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/fix-bug-0',
      expect.objectContaining({ preserveBranchOnDelete: true })
    )
    expect(result).toMatchObject({
      worktree: expect.objectContaining({
        path: '/workspace/fix-bug-0',
        branch: 'refs/heads/fix/bug-0'
      })
    })
  })

  it('reuses an existing local branch when the worktree folder is renamed (#5181)', async () => {
    // Why: reuse keeps branchNameOverride on the selected branch though the folder is renamed; backend must check out that branch (no -b).
    listWorktreesMock
      .mockResolvedValueOnce([
        {
          path: '/workspace/repo',
          head: 'main',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        }
      ])
      .mockResolvedValueOnce([
        {
          path: '/workspace/repo',
          head: 'main',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        },
        {
          path: '/workspace/my-folder',
          head: 'abc123',
          branch: 'refs/heads/fix/bug-0',
          isBare: false,
          isMainWorktree: false
        }
      ])

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'my-folder',
      baseBranch: 'fix/bug-0',
      branchNameOverride: 'fix/bug-0'
    })

    expect(getBranchConflictKindMock).not.toHaveBeenCalled()
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/my-folder',
      'fix/bug-0',
      'fix/bug-0',
      false,
      false,
      { checkoutExistingBranch: true }
    )
    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/my-folder',
      expect.objectContaining({ preserveBranchOnDelete: true })
    )
    expect(result).toMatchObject({
      worktree: expect.objectContaining({
        path: '/workspace/my-folder',
        branch: 'refs/heads/fix/bug-0'
      })
    })
  })

  it('suffixes only the path when an existing local branch checkout path already exists', async () => {
    const mainWorktree = {
      path: '/workspace/repo',
      head: 'main',
      branch: 'refs/heads/main',
      isBare: false,
      isMainWorktree: true
    }
    computeWorktreePathMock.mockImplementation((sanitizedName: string) =>
      sanitizedName === 'fix-bug-0' ? process.cwd() : `/workspace/${sanitizedName}`
    )
    listWorktreesMock
      .mockResolvedValueOnce([mainWorktree])
      .mockResolvedValueOnce([mainWorktree])
      .mockResolvedValueOnce([
        mainWorktree,
        {
          path: '/workspace/fix-bug-0-2',
          head: 'abc123',
          branch: 'refs/heads/fix/bug-0',
          isBare: false,
          isMainWorktree: false
        }
      ])

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'fix/bug-0',
      baseBranch: 'fix/bug-0',
      branchNameOverride: 'fix/bug-0'
    })

    expect(getBranchConflictKindMock).not.toHaveBeenCalled()
    expect(getPRForBranchMock).not.toHaveBeenCalled()
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/fix-bug-0-2',
      'fix/bug-0',
      'fix/bug-0',
      false,
      false,
      { checkoutExistingBranch: true }
    )
    expect(result).toMatchObject({
      worktree: expect.objectContaining({
        path: '/workspace/fix-bug-0-2',
        branch: 'refs/heads/fix/bug-0'
      })
    })
  })

  it('suffixes branchNameOverride when the requested branch collides', async () => {
    getBranchConflictKindMock.mockImplementation(async (_repoPath: string, branch: string) =>
      branch === 'feature/something' ? 'remote' : null
    )
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/feature-something-2',
        head: 'abc123',
        branch: 'refs/heads/feature/something-2',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'feature/something',
      branchNameOverride: 'feature/something'
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['check-ref-format', '--branch', 'feature/something-2'],
      { cwd: '/workspace/repo' }
    )
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/feature-something-2',
      'feature/something-2',
      'origin/main',
      false
    )
  })

  it('allows a resolver-provided PR branch override to match its remote push target', async () => {
    getBranchConflictKindMock.mockImplementation(async (_repoPath: string, branch: string) =>
      branch === 'feature/fix' ? 'remote' : null
    )
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/fix-title',
        head: 'abc123',
        branch: 'refs/heads/feature/fix',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => meta)
    getPRForBranchMock.mockResolvedValueOnce({
      number: 42,
      title: 'Selected PR',
      state: 'open',
      url: 'https://example.com/pr/42',
      checksStatus: 'success',
      updatedAt: '2026-05-21T00:00:00Z',
      mergeable: 'UNKNOWN'
    })

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'fix-title',
      baseBranch: 'abc123',
      compareBaseRef: 'refs/remotes/origin/main',
      branchNameOverride: 'feature/fix',
      linkedPR: 42,
      pushTarget: { remoteName: 'origin', branchName: 'feature/fix' }
    })

    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/fix-title',
      'feature/fix',
      'abc123',
      false
    )
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['branch', '--set-upstream-to', 'origin/feature/fix', 'feature/fix'],
      { cwd: '/workspace/fix-title' }
    )
    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/fix-title',
      expect.objectContaining({
        baseRef: 'refs/remotes/origin/main',
        linkedPR: 42
      })
    )
    expect(getPRForBranchMock).toHaveBeenCalledWith('/workspace/repo', 'feature/fix')
  })

  it('persists an explicit compare base ahead of the checkout remote-tracking base', async () => {
    runtimeStub.resolveRemoteTrackingBase.mockResolvedValueOnce({
      base: 'origin/source-branch',
      remote: 'origin',
      branch: 'source-branch',
      ref: 'refs/remotes/origin/source-branch'
    })
    runtimeStub.hasRemoteTrackingRef.mockResolvedValueOnce(true)
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/fix-title',
        head: 'abc123',
        branch: 'refs/heads/feature/fix',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => meta)

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'fix-title',
      baseBranch: 'origin/source-branch',
      compareBaseRef: 'refs/remotes/origin/main',
      branchNameOverride: 'feature/fix',
      linkedPR: 7,
      pushTarget: { remoteName: 'origin', branchName: 'feature/fix' }
    })

    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/fix-title',
      expect.objectContaining({
        baseRef: 'refs/remotes/origin/main',
        linkedPR: 7
      })
    )
  })

  it('suffixes a matching push target branch without selected PR metadata', async () => {
    getBranchConflictKindMock.mockImplementation(async (_repoPath: string, branch: string) =>
      branch === 'feature/fix' ? 'remote' : null
    )
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/fix-title-2',
        head: 'abc123',
        branch: 'refs/heads/feature/fix-2',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'fix-title',
      baseBranch: 'abc123',
      branchNameOverride: 'feature/fix',
      pushTarget: { remoteName: 'origin', branchName: 'feature/fix' }
    })

    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/fix-title-2',
      'feature/fix-2',
      'abc123',
      false
    )
  })

  it('suffixes a matching push target branch when selected PR metadata has no PR number', async () => {
    getBranchConflictKindMock.mockImplementation(async (_repoPath: string, branch: string) =>
      branch === 'feature/fix' ? 'remote' : null
    )
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/fix-title-2',
        head: 'abc123',
        branch: 'refs/heads/feature/fix-2',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'fix-title',
      baseBranch: 'abc123',
      branchNameOverride: 'feature/fix',
      linkedPR: null,
      pushTarget: { remoteName: 'origin', branchName: 'feature/fix' }
    })

    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/fix-title-2',
      'feature/fix-2',
      'abc123',
      false
    )
  })

  it('suffixes a matching push target branch when the existing PR is different', async () => {
    getBranchConflictKindMock.mockImplementation(async (_repoPath: string, branch: string) =>
      branch === 'feature/fix' ? 'remote' : null
    )
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/fix-title-2',
        head: 'abc123',
        branch: 'refs/heads/feature/fix-2',
        isBare: false,
        isMainWorktree: false
      }
    ])
    getPRForBranchMock.mockResolvedValueOnce({
      number: 43,
      title: 'Different PR',
      state: 'open',
      url: 'https://example.com/pr/43',
      checksStatus: 'success',
      updatedAt: '2026-05-21T00:00:00Z',
      mergeable: 'UNKNOWN'
    })

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'fix-title',
      baseBranch: 'abc123',
      branchNameOverride: 'feature/fix',
      linkedPR: 42,
      pushTarget: { remoteName: 'origin', branchName: 'feature/fix' }
    })

    expect(getPRForBranchMock).toHaveBeenCalledWith('/workspace/repo', 'feature/fix')
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/fix-title-2',
      'feature/fix-2',
      'abc123',
      false
    )
  })

  it('suffixes a selected PR remote conflict when the PR lookup fails', async () => {
    getBranchConflictKindMock.mockImplementation(async (_repoPath: string, branch: string) =>
      branch === 'feature/fix' ? 'remote' : null
    )
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/fix-title-2',
        head: 'abc123',
        branch: 'refs/heads/feature/fix-2',
        isBare: false,
        isMainWorktree: false
      }
    ])
    getPRForBranchMock.mockRejectedValueOnce(new Error('gh unavailable'))

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'fix-title',
      baseBranch: 'abc123',
      branchNameOverride: 'feature/fix',
      linkedPR: 42,
      pushTarget: { remoteName: 'origin', branchName: 'feature/fix' }
    })

    expect(getPRForBranchMock).toHaveBeenCalledWith('/workspace/repo', 'feature/fix')
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/fix-title-2',
      'feature/fix-2',
      'abc123',
      false
    )
  })

  it('checks out an unused existing PR branch only when it is at the resolved head SHA', async () => {
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args.includes('refs/heads/feature/fix^{commit}')) {
        return { stdout: 'abc123\n', stderr: '' }
      }
      if (args[0] === 'rev-parse' && args.includes('abc123^{commit}')) {
        return { stdout: 'abc123\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    listWorktreesMock
      .mockResolvedValueOnce([
        {
          path: '/workspace/repo',
          head: 'main',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        }
      ])
      .mockResolvedValueOnce([
        {
          path: '/workspace/repo',
          head: 'main',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        },
        {
          path: '/workspace/fix-title',
          head: 'abc123',
          branch: 'refs/heads/feature/fix',
          isBare: false,
          isMainWorktree: false
        }
      ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'fix-title',
      baseBranch: 'abc123',
      branchNameOverride: 'feature/fix'
    })

    expect(getBranchConflictKindMock).not.toHaveBeenCalled()
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/fix-title',
      'feature/fix',
      'abc123',
      false,
      false,
      { checkoutExistingBranch: true }
    )
  })

  it('suffixes an existing PR branch when its tip differs from the resolved head SHA', async () => {
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args.includes('refs/heads/feature/fix^{commit}')) {
        return { stdout: 'old123\n', stderr: '' }
      }
      if (args[0] === 'rev-parse' && args.includes('abc123^{commit}')) {
        return { stdout: 'abc123\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    getBranchConflictKindMock.mockResolvedValueOnce('local')
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/fix-title-2',
        head: 'abc123',
        branch: 'refs/heads/feature/fix-2',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'fix-title',
      baseBranch: 'abc123',
      branchNameOverride: 'feature/fix'
    })

    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/fix-title-2',
      'feature/fix-2',
      'abc123',
      false
    )
  })

  it('persists a sanitized artifact title as the worktree display name', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard',
        head: 'abc123',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => meta)

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      displayName: '  Fix: dashboards\nfor PRs\u0000  '
    })

    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/improve-dashboard',
      expect.objectContaining({
        displayName: 'Fix: dashboards for PRs'
      })
    )
    expect(result).toMatchObject({
      worktree: expect.objectContaining({
        displayName: 'Fix: dashboards for PRs'
      })
    })
  })

  it('persists linked issue and PR metadata during local create', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard',
        head: 'abc123',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => meta)

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      linkedIssue: 123,
      linkedPR: 456,
      manualOrder: 123_456
    })

    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/improve-dashboard',
      expect.objectContaining({
        linkedIssue: 123,
        linkedPR: 456,
        manualOrder: 123_456
      })
    )
    expect(result).toMatchObject({
      worktree: expect.objectContaining({
        linkedIssue: 123,
        linkedPR: 456,
        manualOrder: 123_456
      })
    })
  })

  it('persists the selected creation agent during local create', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard',
        head: 'abc123',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => meta)

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      createdWithAgent: 'codex'
    })

    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/improve-dashboard',
      expect.objectContaining({
        createdWithAgent: 'codex'
      })
    )
    expect(result).toMatchObject({
      worktree: expect.objectContaining({
        createdWithAgent: 'codex'
      })
    })
  })

  it('configures a PR push target during local create', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard',
        head: 'abc123',
        branch: 'refs/heads/improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => meta)

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      pushTarget: {
        remoteName: 'pr-prateek-orca',
        branchName: 'prateek/fix-sidebar-agents-toggle',
        remoteUrl: 'git@github.com:prateek/orca.git'
      }
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['remote', 'add', 'pr-prateek-orca', 'git@github.com:prateek/orca.git'],
      { cwd: '/workspace/repo' }
    )
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      [
        'fetch',
        'pr-prateek-orca',
        '+refs/heads/prateek/fix-sidebar-agents-toggle:refs/remotes/pr-prateek-orca/prateek/fix-sidebar-agents-toggle'
      ],
      { cwd: '/workspace/repo' }
    )
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      [
        'branch',
        '--set-upstream-to',
        'pr-prateek-orca/prateek/fix-sidebar-agents-toggle',
        'improve-dashboard'
      ],
      { cwd: '/workspace/improve-dashboard' }
    )
    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/improve-dashboard',
      expect.objectContaining({
        pushTarget: expect.objectContaining({
          remoteName: 'pr-prateek-orca',
          branchName: 'prateek/fix-sidebar-agents-toggle',
          remoteUrl: 'git@github.com:prateek/orca.git',
          remoteCreated: true
        })
      })
    )
  })

  it('keeps the Orca-created marker when a new worktree reuses an Orca-created fork remote', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard',
        head: 'abc123',
        branch: 'refs/heads/improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    const existingPushTarget = {
      remoteName: 'pr-contributor-orca',
      branchName: 'contributor/previous-fix',
      remoteUrl: 'https://github.com/contributor/orca.git',
      remoteCreated: true
    }
    store.getAllWorktreeMeta.mockReturnValue({
      'repo-1::/workspace/previous-fix': makeWorktreeMeta({ pushTarget: existingPushTarget })
    })
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => meta)
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote' && args.length === 1) {
        return { stdout: 'pr-contributor-orca\n', stderr: '' }
      }
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'https://github.com/contributor/orca.git\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      pushTarget: {
        remoteName: 'pr-contributor-orca',
        branchName: 'contributor/new-fix',
        remoteUrl: 'https://github.com/contributor/orca.git'
      }
    })

    expect(gitExecFileAsyncMock).not.toHaveBeenCalledWith(
      ['remote', 'add', expect.any(String), expect.any(String)],
      expect.any(Object)
    )
    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/improve-dashboard',
      expect.objectContaining({
        pushTarget: expect.objectContaining({
          remoteName: 'pr-contributor-orca',
          branchName: 'contributor/new-fix',
          remoteUrl: 'https://github.com/contributor/orca.git',
          remoteCreated: true
        })
      })
    )
  })

  it('threads explicit origin preference into dual-remote PR head resolution', async () => {
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: '/workspace/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      issueSourcePreference: 'origin',
      worktreeBaseRef: null
    })
    getPullRequestPushTargetMock.mockResolvedValue({
      pushTarget: {
        remoteName: 'pr-prateek-orca',
        branchName: 'prateek/fix-sidebar-agents-toggle',
        remoteUrl: 'git@github.com:prateek/orca.git'
      }
    })
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        const url =
          args[2] === 'origin' ? ORIGIN_REMOTE_URL : 'git@github.com:org/upstream-repo.git'
        return { stdout: `${url}\n`, stderr: '' }
      }
      if (args[0] === 'remote') {
        return { stdout: 'origin\nupstream\n', stderr: '' }
      }
      if (args[0] === 'rev-parse') {
        return { stdout: 'abc123\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const result = await handlers['worktrees:resolvePrBase'](null, {
      repoId: 'repo-1',
      prNumber: 1738,
      headRefName: 'prateek/fix-sidebar-agents-toggle',
      isCrossRepository: true
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      [
        'fetch',
        '--no-tags',
        'origin',
        `+refs/pull/1738/head:refs/orca/pull/${ORIGIN_HEAD_COMPONENT}/1738`
      ],
      { cwd: '/workspace/repo', timeout: REVIEW_HEAD_FETCH_TIMEOUT_MS }
    )
    expect(gitExecFileAsyncMock).not.toHaveBeenCalledWith(
      ['remote', 'get-url', 'upstream'],
      expect.anything()
    )
    expect(getPullRequestPushTargetMock).toHaveBeenCalledWith(
      '/workspace/repo',
      1738,
      null,
      {},
      'origin'
    )
    expect(result).toMatchObject({
      baseBranch: 'abc123',
      headSha: 'abc123',
      branchNameOverride: 'prateek/fix-sidebar-agents-toggle',
      pushTarget: {
        remoteName: 'pr-prateek-orca',
        branchName: 'prateek/fix-sidebar-agents-toggle',
        remoteUrl: 'git@github.com:prateek/orca.git'
      }
    })
  })

  it('returns the same-repo PR head SHA and exact branch override when resolving a PR base', async () => {
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') {
        return { stdout: 'def456\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const result = await handlers['worktrees:resolvePrBase'](null, {
      repoId: 'repo-1',
      prNumber: 42,
      headRefName: 'feature/add-feature',
      isCrossRepository: false
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      [
        'fetch',
        'origin',
        '+refs/heads/feature/add-feature:refs/remotes/origin/feature/add-feature'
      ],
      { cwd: '/workspace/repo' }
    )
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['rev-parse', '--verify', 'origin/feature/add-feature'],
      { cwd: '/workspace/repo' }
    )
    expect(result).toMatchObject({
      baseBranch: 'def456',
      headSha: 'def456',
      branchNameOverride: 'feature/add-feature',
      pushTarget: { remoteName: 'origin', branchName: 'feature/add-feature' }
    })
  })

  it('routes local worktree creation through the selected WSL project runtime', async () => {
    mockSelectedWslProjectRuntime()
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/repo',
        head: 'base',
        branch: 'refs/heads/main',
        isBare: false,
        isMainWorktree: true
      },
      {
        path: '/workspace/improve-dashboard',
        head: 'abc123',
        branch: 'refs/heads/improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard'
    })

    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/improve-dashboard',
      'improve-dashboard',
      'origin/main',
      false,
      false,
      { wslDistro: 'Ubuntu' }
    )
    expect(resolveDefaultBaseRefWithLocalGitMock).toHaveBeenCalledWith({
      cwd: '/workspace/repo',
      wslDistro: 'Ubuntu'
    })
    expect(getBranchConflictKindMock).toHaveBeenCalledWith(
      '/workspace/repo',
      'improve-dashboard',
      'origin/main',
      { wslDistro: 'Ubuntu' }
    )
    expect(listWorktreesMock).toHaveBeenCalledWith('/workspace/repo', { wslDistro: 'Ubuntu' })
  })

  it('routes fork push target setup through the selected WSL project runtime', async () => {
    mockSelectedWslProjectRuntime()
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/wsl-fork',
        head: 'abc123',
        branch: 'refs/heads/wsl-fork',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => meta)

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'wsl-fork',
      pushTarget: {
        remoteName: 'pr-contributor-orca',
        branchName: 'contributor/wsl-fork',
        remoteUrl: 'git@github.com:contributor/orca.git'
      }
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['check-ref-format', '--branch', 'contributor/wsl-fork'],
      { cwd: '/workspace/repo', wslDistro: 'Ubuntu' }
    )
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['remote', 'add', 'pr-contributor-orca', 'git@github.com:contributor/orca.git'],
      { cwd: '/workspace/repo', wslDistro: 'Ubuntu' }
    )
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      [
        'fetch',
        'pr-contributor-orca',
        '+refs/heads/contributor/wsl-fork:refs/remotes/pr-contributor-orca/contributor/wsl-fork'
      ],
      { cwd: '/workspace/repo', wslDistro: 'Ubuntu' }
    )
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['branch', '--set-upstream-to', 'pr-contributor-orca/contributor/wsl-fork', 'wsl-fork'],
      { cwd: '/workspace/wsl-fork', wslDistro: 'Ubuntu' }
    )
  })

  it('routes selected PR branch conflict lookup through the selected WSL project runtime', async () => {
    mockSelectedWslProjectRuntime()
    getBranchConflictKindMock.mockResolvedValueOnce('remote')
    getPRForBranchMock.mockResolvedValueOnce({
      number: 42,
      title: 'Selected PR',
      state: 'open',
      url: 'https://example.com/pr/42',
      checksStatus: 'success',
      updatedAt: '2026-06-16T00:00:00.000Z',
      mergeable: 'UNKNOWN'
    })
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/fix-title',
        head: 'abc123',
        branch: 'refs/heads/feature/fix',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'fix-title',
      baseBranch: 'abc123',
      branchNameOverride: 'feature/fix',
      linkedPR: 42,
      pushTarget: { remoteName: 'origin', branchName: 'feature/fix' }
    })

    expect(getPRForBranchMock).toHaveBeenCalledWith(
      '/workspace/repo',
      'feature/fix',
      null,
      null,
      null,
      { localGitExecOptions: { wslDistro: 'Ubuntu' } }
    )
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/fix-title',
      'feature/fix',
      'abc123',
      false,
      false,
      { wslDistro: 'Ubuntu' }
    )
  })

  it('routes PR base git calls through the selected WSL project runtime', async () => {
    setPlatform('win32')
    store.getProjects.mockReturnValue([
      {
        id: 'project-1',
        displayName: 'repo',
        badgeColor: '#000',
        sourceRepoIds: ['repo-1'],
        localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' },
        createdAt: 0,
        updatedAt: 0
      }
    ])
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') {
        return { stdout: 'def456\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const result = await handlers['worktrees:resolvePrBase'](null, {
      repoId: 'repo-1',
      prNumber: 42,
      headRefName: 'feature/add-feature',
      isCrossRepository: false
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      [
        'fetch',
        'origin',
        '+refs/heads/feature/add-feature:refs/remotes/origin/feature/add-feature'
      ],
      { cwd: '/workspace/repo', wslDistro: 'Ubuntu' }
    )
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['rev-parse', '--verify', 'origin/feature/add-feature'],
      { cwd: '/workspace/repo', wslDistro: 'Ubuntu' }
    )
    expect(getDefaultRemoteMock).toHaveBeenCalledWith('/workspace/repo', { wslDistro: 'Ubuntu' })
    expect(result).toMatchObject({
      baseBranch: 'def456',
      headSha: 'def456',
      branchNameOverride: 'feature/add-feature',
      pushTarget: { remoteName: 'origin', branchName: 'feature/add-feature' }
    })
  })

  it('lists detected worktrees through the selected WSL project runtime', async () => {
    setPlatform('win32')
    store.getProjects.mockReturnValue([
      {
        id: 'project-1',
        displayName: 'repo',
        badgeColor: '#000',
        sourceRepoIds: ['repo-1'],
        localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' },
        createdAt: 0,
        updatedAt: 0
      }
    ])
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/repo',
        head: 'def456',
        branch: 'refs/heads/main',
        isBare: false,
        isMainWorktree: true
      }
    ])

    const result = await handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })

    expect(listWorktreesMock).toHaveBeenCalledWith('/workspace/repo', { wslDistro: 'Ubuntu' })
    expect(result).toMatchObject({
      repoId: 'repo-1',
      authoritative: true,
      source: 'git',
      worktrees: [expect.objectContaining({ path: '/workspace/repo' })]
    })
  })

  it('snapshots lineage catalogs once and memoizes repeated owner resolution', async () => {
    const worktreeIds = Array.from(
      { length: 101 },
      (_, index) => `repo-1::/workspace/repo-${index}`
    )
    const lineage = Object.fromEntries(
      worktreeIds.slice(1).map((worktreeId, index) => [
        worktreeId,
        {
          worktreeId,
          worktreeInstanceId: `child-${index}`,
          parentWorktreeId: worktreeIds[index],
          parentWorktreeInstanceId: `parent-${index}`,
          origin: 'cli',
          capture: { source: 'cwd-context', confidence: 'inferred' },
          createdAt: index
        }
      ])
    )
    store.getAllWorktreeLineage.mockReturnValue(lineage)
    store.getRepos.mockClear()
    store.getFolderWorkspaces.mockClear()
    store.getProjectGroups.mockClear()
    store.getWorktreeMeta.mockClear()

    const result = await handlers['worktrees:listLineageForHost'](ipcEvent, {
      executionHostId: 'local'
    })

    expect(result).toMatchObject({ authoritative: true })
    expect(
      Object.keys((result as { worktreeLineageById: Record<string, unknown> }).worktreeLineageById)
    ).toHaveLength(100)
    expect(store.getRepos).toHaveBeenCalledOnce()
    expect(store.getFolderWorkspaces).toHaveBeenCalledOnce()
    expect(store.getProjectGroups).toHaveBeenCalledOnce()
    expect(store.getWorktreeMeta).toHaveBeenCalledTimes(101)
  })

  it('hydrates folder-repo detected rows with instance-validated legacy lineage', async () => {
    const folderRepo = {
      id: 'repo-1',
      path: '/workspace/folder',
      displayName: 'folder',
      badgeColor: '#000',
      addedAt: 0,
      kind: 'folder' as const
    }
    const parentId = `${folderRepo.id}::${folderRepo.path}`
    const childId = `${parentId}::workspace:child-instance`
    const metaById: Record<string, Record<string, unknown>> = {
      [parentId]: makeWorktreeMeta({
        instanceId: 'parent-instance',
        projectId: 'repo:repo-1',
        hostId: 'local',
        projectHostSetupId: 'repo-1'
      }),
      [childId]: makeWorktreeMeta({
        instanceId: 'child-instance',
        projectId: 'repo:repo-1',
        hostId: 'local',
        projectHostSetupId: 'repo-1'
      })
    }
    store.getRepos.mockReturnValue([folderRepo])
    store.getRepo.mockReturnValue(folderRepo)
    store.getAllWorktreeMeta.mockReturnValue(metaById)
    store.getWorktreeMeta.mockImplementation((worktreeId: string) => metaById[worktreeId])
    store.getAllWorktreeLineage.mockReturnValue({
      [childId]: {
        worktreeId: childId,
        worktreeInstanceId: 'child-instance',
        parentWorktreeId: parentId,
        parentWorktreeInstanceId: 'parent-instance',
        origin: 'cli',
        capture: { source: 'explicit-cli-flag', confidence: 'explicit' },
        createdAt: 1
      }
    })

    const result = (await handlers['worktrees:listDetected'](null, {
      repoId: folderRepo.id
    })) as { worktrees: (Worktree & { lineage?: unknown; parentWorktreeId?: string | null })[] }

    expect(result.worktrees).toEqual([
      expect.objectContaining({
        id: parentId,
        parentWorktreeId: null,
        childWorktreeIds: [childId],
        lineage: null
      }),
      expect.objectContaining({
        id: childId,
        parentWorktreeId: parentId,
        lineage: expect.objectContaining({ parentWorktreeInstanceId: 'parent-instance' })
      })
    ])
  })

  it('hides agent scratch created inside a linked checkout from desktop listings', async () => {
    const linkedCheckoutPath = '/workspace/feature-x'
    const scratchPath = `${linkedCheckoutPath}/.claude/worktrees/agent-a04ccaaa`
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/repo',
        head: 'main-head',
        branch: 'refs/heads/main',
        isBare: false,
        isMainWorktree: true
      },
      {
        path: linkedCheckoutPath,
        head: 'feature-head',
        branch: 'refs/heads/feature-x',
        isBare: false,
        isMainWorktree: false
      },
      {
        path: scratchPath,
        head: 'scratch-head',
        branch: 'refs/heads/worktree-agent-a04ccaaa',
        isBare: false,
        isMainWorktree: false
      }
    ])

    const detected = (await handlers['worktrees:listDetected'](null, {
      repoId: 'repo-1'
    })) as { worktrees: (Worktree & { ownership: string; visible: boolean })[] }
    const visible = (await handlers['worktrees:list'](null, { repoId: 'repo-1' })) as Worktree[]

    expect(detected.worktrees.find((worktree) => worktree.path === scratchPath)).toMatchObject({
      ownership: 'agent-scratch',
      visible: false
    })
    expect(visible.map((worktree) => worktree.path)).toEqual([
      '/workspace/repo',
      linkedCheckoutPath
    ])
  })

  it('does not reuse host detected worktree scans for a selected WSL runtime', async () => {
    listWorktreesMock
      .mockResolvedValueOnce([
        {
          path: '/workspace/repo',
          head: 'host-head',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        }
      ])
      .mockResolvedValueOnce([
        {
          path: '/workspace/repo',
          head: 'wsl-head',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        }
      ])

    const hostResult = (await handlers['worktrees:listDetected'](null, {
      repoId: 'repo-1'
    })) as { worktrees: Worktree[] }
    setPlatform('win32')
    store.getProjects.mockReturnValue([
      {
        id: 'project-1',
        displayName: 'repo',
        badgeColor: '#000',
        sourceRepoIds: ['repo-1'],
        localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' },
        createdAt: 0,
        updatedAt: 0
      }
    ])
    const wslResult = (await handlers['worktrees:listDetected'](null, {
      repoId: 'repo-1'
    })) as { worktrees: Worktree[] }

    expect(hostResult.worktrees[0].head).toBe('host-head')
    expect(wslResult.worktrees[0].head).toBe('wsl-head')
    expect(listWorktreesMock).toHaveBeenCalledTimes(2)
    expect(listWorktreesMock).toHaveBeenNthCalledWith(1, '/workspace/repo')
    expect(listWorktreesMock).toHaveBeenNthCalledWith(2, '/workspace/repo', {
      wslDistro: 'Ubuntu'
    })
  })

  it('reuses a recent authoritative detected worktree scan', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/repo',
        head: 'main-head',
        branch: 'refs/heads/main',
        isBare: false,
        isMainWorktree: true
      }
    ])

    const first = await handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })
    const second = await handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })

    expect(first).toEqual(second)
    expect(listWorktreesMock).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent authoritative detected worktree scans', async () => {
    listWorktreesMock.mockImplementation(async () => {
      await Promise.resolve()
      return [
        {
          path: '/workspace/repo',
          head: 'main-head',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        }
      ]
    })

    await Promise.all([
      handlers['worktrees:listDetected'](null, { repoId: 'repo-1' }),
      handlers['worktrees:listDetected'](null, { repoId: 'repo-1' }),
      handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })
    ])

    expect(listWorktreesMock).toHaveBeenCalledTimes(1)
  })

  it('rechecks detected worktree metadata while reusing a cached raw scan', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/repo',
        head: 'main-head',
        branch: 'refs/heads/main',
        isBare: false,
        isMainWorktree: true
      }
    ])

    let currentMeta = makeWorktreeMeta({ isPinned: false })
    store.getWorktreeMeta.mockImplementation(() => currentMeta)
    store.setWorktreeMeta.mockImplementation(() => currentMeta)
    const first = (await handlers['worktrees:listDetected'](null, {
      repoId: 'repo-1'
    })) as { worktrees: Worktree[] }
    currentMeta = makeWorktreeMeta({ isPinned: true })
    const second = (await handlers['worktrees:listDetected'](null, {
      repoId: 'repo-1'
    })) as { worktrees: Worktree[] }

    expect(first.worktrees[0].isPinned).toBe(false)
    expect(second.worktrees[0].isPinned).toBe(true)
    expect(listWorktreesMock).toHaveBeenCalledTimes(1)
  })

  it('rescans detected worktrees after the scan cache TTL expires', async () => {
    vi.useFakeTimers()
    try {
      listWorktreesMock
        .mockResolvedValueOnce([
          {
            path: '/workspace/repo',
            head: 'main-head',
            branch: 'refs/heads/main',
            isBare: false,
            isMainWorktree: true
          }
        ])
        .mockResolvedValueOnce([
          {
            path: '/workspace/repo',
            head: 'main-head',
            branch: 'refs/heads/main',
            isBare: false,
            isMainWorktree: true
          },
          {
            path: '/workspace/new-worktree',
            head: 'feature-head',
            branch: 'refs/heads/feature',
            isBare: false,
            isMainWorktree: false
          }
        ])

      await handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })
      await vi.advanceTimersByTimeAsync(5_001)
      const second = (await handlers['worktrees:listDetected'](null, {
        repoId: 'repo-1'
      })) as { worktrees: Worktree[] }

      expect(second.worktrees.map((worktree) => worktree.path)).toEqual([
        '/workspace/repo',
        '/workspace/new-worktree'
      ])
      expect(listWorktreesMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts the detected scan cache TTL after a slow scan completes', async () => {
    vi.useFakeTimers()
    try {
      listWorktreesMock
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () =>
                  resolve([
                    {
                      path: '/workspace/repo',
                      head: 'main-head',
                      branch: 'refs/heads/main',
                      isBare: false,
                      isMainWorktree: true
                    }
                  ]),
                6_000
              )
            })
        )
        .mockResolvedValueOnce([
          {
            path: '/workspace/repo',
            head: 'main-head',
            branch: 'refs/heads/main',
            isBare: false,
            isMainWorktree: true
          },
          {
            path: '/workspace/new-worktree',
            head: 'feature-head',
            branch: 'refs/heads/feature',
            isBare: false,
            isMainWorktree: false
          }
        ])

      const first = handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })
      await vi.advanceTimersByTimeAsync(6_000)
      await first
      const second = (await handlers['worktrees:listDetected'](null, {
        repoId: 'repo-1'
      })) as { worktrees: Worktree[] }

      expect(second.worktrees.map((worktree) => worktree.path)).toEqual(['/workspace/repo'])
      expect(listWorktreesMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('invalidates the detected scan cache before worktree change notifications', async () => {
    listWorktreesMock
      .mockResolvedValueOnce([
        {
          path: '/workspace/repo',
          head: 'main-head',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        }
      ])
      .mockResolvedValueOnce([
        {
          path: '/workspace/repo',
          head: 'main-head',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        },
        {
          path: '/workspace/new-worktree',
          head: 'feature-head',
          branch: 'refs/heads/feature',
          isBare: false,
          isMainWorktree: false
        }
      ])

    await handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })
    notifyWorktreesChanged(mainWindow as never, 'repo-1')
    const second = (await handlers['worktrees:listDetected'](null, {
      repoId: 'repo-1'
    })) as { worktrees: Worktree[] }

    expect(second.worktrees).toHaveLength(2)
    expect(listWorktreesMock).toHaveBeenCalledTimes(2)
  })

  it('rescans detected worktrees after the local create flow notifies worktree changes', async () => {
    listWorktreesMock
      .mockResolvedValueOnce([
        {
          path: '/workspace/repo',
          head: 'main-head',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        }
      ])
      .mockResolvedValueOnce([
        {
          path: '/workspace/repo',
          head: 'main-head',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        },
        {
          path: '/workspace/improve-dashboard',
          head: 'feature-head',
          branch: 'refs/heads/improve-dashboard',
          isBare: false,
          isMainWorktree: false
        }
      ])
      .mockResolvedValueOnce([
        {
          path: '/workspace/repo',
          head: 'main-head',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        },
        {
          path: '/workspace/improve-dashboard',
          head: 'feature-head',
          branch: 'refs/heads/improve-dashboard',
          isBare: false,
          isMainWorktree: false
        }
      ])

    await handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })
    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard'
    })
    const detected = (await handlers['worktrees:listDetected'](null, {
      repoId: 'repo-1'
    })) as { worktrees: Worktree[] }

    expect(detected.worktrees.map((worktree) => worktree.path)).toEqual([
      '/workspace/repo',
      '/workspace/improve-dashboard'
    ])
    expect(listWorktreesMock).toHaveBeenCalledTimes(3)
  })

  it('does not run fresh-scan side effects from a detected scan invalidated while in flight', async () => {
    let resolveScan: (worktrees: GitWorktreeInfo[]) => void = () => {}
    listWorktreesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveScan = resolve as (worktrees: GitWorktreeInfo[]) => void
        })
    )
    store.getAllWorktreeLineage.mockReturnValue({
      'repo-1::/workspace/new-worktree': {
        worktreeId: 'repo-1::/workspace/new-worktree',
        worktreeInstanceId: 'child-instance',
        parentWorktreeId: 'repo-1::/workspace/repo',
        parentWorktreeInstanceId: 'parent-instance',
        origin: 'manual',
        capture: {
          source: 'manual-action',
          confidence: 'explicit'
        },
        createdAt: 0
      }
    })

    const pendingList = handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })
    await Promise.resolve()
    notifyWorktreesChanged(mainWindow as never, 'repo-1')
    resolveScan([
      {
        path: '/workspace/repo',
        head: 'main-head',
        branch: 'refs/heads/main',
        isBare: false,
        isMainWorktree: true
      }
    ])

    await pendingList

    expect(store.removeWorktreeLineage).not.toHaveBeenCalled()
    expect(listWorktreesMock).toHaveBeenCalledTimes(1)
  })

  it('does not retain invalidated detected scans after they settle', async () => {
    let resolveScan: (worktrees: GitWorktreeInfo[]) => void = () => {}
    listWorktreesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveScan = resolve as (worktrees: GitWorktreeInfo[]) => void
        })
    )

    const pendingList = handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })
    await Promise.resolve()

    expect(__getDetectedWorktreeScanCacheStatsForTests()).toMatchObject({
      cacheSize: 0,
      inFlightSize: 1
    })

    notifyWorktreesChanged(mainWindow as never, 'repo-1')

    expect(__getDetectedWorktreeScanCacheStatsForTests()).toMatchObject({
      cacheSize: 0,
      inFlightSize: 0
    })

    resolveScan([
      {
        path: '/workspace/repo',
        head: 'main-head',
        branch: 'refs/heads/main',
        isBare: false,
        isMainWorktree: true
      }
    ])
    await pendingList

    expect(__getDetectedWorktreeScanCacheStatsForTests()).toMatchObject({
      cacheSize: 0,
      inFlightSize: 0
    })
  })

  it('does not accumulate scan bookkeeping across prolonged repository churn', async () => {
    listWorktreesMock.mockImplementation(async (repoPath: string) => [
      {
        path: repoPath,
        head: 'main-head',
        branch: 'refs/heads/main',
        isBare: false,
        isMainWorktree: true
      }
    ])

    for (let index = 0; index < 128; index += 1) {
      const repoId = `repo-${index}`
      store.getRepos.mockReturnValue([
        {
          id: repoId,
          path: `/workspace/${repoId}`,
          displayName: repoId,
          badgeColor: '#000',
          addedAt: 0,
          worktreeBaseRef: null
        }
      ])
      await handlers['worktrees:listDetected'](null, { repoId })
      notifyWorktreesChanged(mainWindow as never, repoId)
    }

    expect(__getDetectedWorktreeScanCacheStatsForTests()).toEqual({
      cacheSize: 0,
      inFlightSize: 0
    })
    expect(listWorktreesMock).toHaveBeenCalledTimes(128)
  })

  it('keeps a replacement scan current after an older scan settles first', async () => {
    const resolvers: ((worktrees: GitWorktreeInfo[]) => void)[] = []
    listWorktreesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve as (worktrees: GitWorktreeInfo[]) => void)
        })
    )
    const result = [
      {
        path: '/workspace/repo',
        head: 'main-head',
        branch: 'refs/heads/main',
        isBare: false,
        isMainWorktree: true
      }
    ]

    const staleList = handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })
    await Promise.resolve()
    notifyWorktreesChanged(mainWindow as never, 'repo-1')
    const replacementList = handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })
    await Promise.resolve()

    resolvers[0](result)
    await staleList
    expect(__getDetectedWorktreeScanCacheStatsForTests()).toEqual({
      cacheSize: 0,
      inFlightSize: 1
    })

    resolvers[1](result)
    await replacementList
    expect(__getDetectedWorktreeScanCacheStatsForTests()).toEqual({
      cacheSize: 1,
      inFlightSize: 0
    })
  })

  it('does not let an older scan overwrite a replacement that settles first', async () => {
    const resolvers: ((worktrees: GitWorktreeInfo[]) => void)[] = []
    listWorktreesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve as (worktrees: GitWorktreeInfo[]) => void)
        })
    )
    store.getAllWorktreeLineage.mockReturnValue({
      'repo-1::/workspace/fresh-worktree': {
        worktreeId: 'repo-1::/workspace/fresh-worktree',
        worktreeInstanceId: 'child-instance',
        parentWorktreeId: 'repo-1::/workspace/repo',
        parentWorktreeInstanceId: 'parent-instance',
        origin: 'manual',
        capture: {
          source: 'manual-action',
          confidence: 'explicit'
        },
        createdAt: 0
      }
    })
    const mainWorktree: GitWorktreeInfo = {
      path: '/workspace/repo',
      head: 'main-head',
      branch: 'refs/heads/main',
      isBare: false,
      isMainWorktree: true
    }

    const staleList = handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })
    await Promise.resolve()
    notifyWorktreesChanged(mainWindow as never, 'repo-1')
    const replacementList = handlers['worktrees:listDetected'](null, { repoId: 'repo-1' })
    await Promise.resolve()

    resolvers[1]([
      mainWorktree,
      {
        path: '/workspace/fresh-worktree',
        head: 'fresh-head',
        branch: 'refs/heads/fresh-worktree',
        isBare: false,
        isMainWorktree: false
      }
    ])
    await replacementList

    resolvers[0]([
      mainWorktree,
      {
        path: '/workspace/stale-worktree',
        head: 'stale-head',
        branch: 'refs/heads/stale-worktree',
        isBare: false,
        isMainWorktree: false
      }
    ])
    await staleList

    const cached = (await handlers['worktrees:listDetected'](null, {
      repoId: 'repo-1'
    })) as { worktrees: Worktree[] }
    expect(cached.worktrees.map((worktree) => worktree.path)).toEqual([
      '/workspace/repo',
      '/workspace/fresh-worktree'
    ])
    expect(store.removeWorktreeLineage).not.toHaveBeenCalled()
    await expect(
      resolveRegisteredWorktreePath('/workspace/fresh-worktree', store as never)
    ).resolves.toBe(resolve('/workspace/fresh-worktree'))
    await expect(
      resolveRegisteredWorktreePath('/workspace/stale-worktree', store as never)
    ).rejects.toThrow('Access denied: unknown repository or worktree path')
    expect(listWorktreesMock).toHaveBeenCalledTimes(2)
    expect(__getDetectedWorktreeScanCacheStatsForTests()).toEqual({
      cacheSize: 1,
      inFlightSize: 0
    })
  })

  it('resolves a fork PR base even when push-target discovery fails', async () => {
    getPullRequestPushTargetMock.mockRejectedValueOnce(new Error('lookup failed'))
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: `${ORIGIN_REMOTE_URL}\n`, stderr: '' }
      }
      if (args[0] === 'rev-parse') {
        return { stdout: 'abc123\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const result = await handlers['worktrees:resolvePrBase'](null, {
      repoId: 'repo-1',
      prNumber: 1849,
      headRefName: 'feat/onboarding-model-choice-782',
      isCrossRepository: true
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      [
        'fetch',
        '--no-tags',
        'origin',
        `+refs/pull/1849/head:refs/orca/pull/${ORIGIN_HEAD_COMPONENT}/1849`
      ],
      { cwd: '/workspace/repo', timeout: REVIEW_HEAD_FETCH_TIMEOUT_MS }
    )
    expect(result).toEqual({
      baseBranch: 'abc123',
      headSha: 'abc123',
      branchNameOverride: 'feat/onboarding-model-choice-782'
    })
  })

  it('falls back to refs/pull/<N>/head when branch fetch fails for a PR', async () => {
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (
        args[0] === 'fetch' &&
        args[2] ===
          '+refs/heads/feat/onboarding-model-choice-782:refs/remotes/origin/feat/onboarding-model-choice-782'
      ) {
        throw new Error(
          'fatal: could not find remote ref refs/heads/feat/onboarding-model-choice-782'
        )
      }
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: `${ORIGIN_REMOTE_URL}\n`, stderr: '' }
      }
      if (args[0] === 'rev-parse') {
        return { stdout: 'abc123\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const result = await handlers['worktrees:resolvePrBase'](null, {
      repoId: 'repo-1',
      prNumber: 1849,
      headRefName: 'feat/onboarding-model-choice-782'
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      [
        'fetch',
        'origin',
        '+refs/heads/feat/onboarding-model-choice-782:refs/remotes/origin/feat/onboarding-model-choice-782'
      ],
      { cwd: '/workspace/repo' }
    )
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      [
        'fetch',
        '--no-tags',
        'origin',
        `+refs/pull/1849/head:refs/orca/pull/${ORIGIN_HEAD_COMPONENT}/1849`
      ],
      { cwd: '/workspace/repo', timeout: REVIEW_HEAD_FETCH_TIMEOUT_MS }
    )
    expect(result).toEqual({
      baseBranch: 'abc123',
      headSha: 'abc123',
      branchNameOverride: 'feat/onboarding-model-choice-782'
    })
  })

  it('does not fall back to refs/pull/<N>/head when branch fetch hits a network failure', async () => {
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (
        args[0] === 'fetch' &&
        args[2] ===
          '+refs/heads/feat/onboarding-model-choice-782:refs/remotes/origin/feat/onboarding-model-choice-782'
      ) {
        throw new Error('fatal: unable to access repo: Could not resolve host: github.com')
      }
      return { stdout: '', stderr: '' }
    })

    const result = await handlers['worktrees:resolvePrBase'](null, {
      repoId: 'repo-1',
      prNumber: 1849,
      headRefName: 'feat/onboarding-model-choice-782'
    })

    expect(gitExecFileAsyncMock).not.toHaveBeenCalledWith(
      expect.arrayContaining(['fetch', '--no-tags']),
      expect.anything()
    )
    expect(result).toMatchObject({
      error:
        'Failed to fetch origin/feat/onboarding-model-choice-782: fatal: unable to access repo: Could not resolve host: github.com'
    })
  })

  it('awaits a cold refresh before creating from an existing remote-tracking base', async () => {
    const remoteBase = {
      remote: 'origin',
      branch: 'main',
      ref: 'refs/remotes/origin/main',
      base: 'origin/main'
    }
    let resolveFetch!: () => void
    const pendingFetch = new Promise<{ ok: true }>((resolve) => {
      resolveFetch = () => resolve({ ok: true })
    })
    runtimeStub.resolveRemoteTrackingBase.mockResolvedValue(remoteBase)
    runtimeStub.hasRemoteTrackingRef.mockResolvedValue(true)
    runtimeStub.getOrStartRemoteTrackingBaseRefresh.mockReturnValue(pendingFetch)
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard',
        head: 'created-sha',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (
        args[0] === 'rev-parse' &&
        (args.includes('refs/remotes/origin/master^{commit}') ||
          args.includes('refs/heads/origin/master^{commit}'))
      ) {
        throw new Error('missing ref')
      }
      return { stdout: 'created-sha\n', stderr: '' }
    })

    const createPromise = handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard'
    }) as Promise<unknown>

    const earlyResult = await Promise.race([
      createPromise.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 0))
    ])
    expect(earlyResult).toBe('pending')
    expect(addWorktreeMock).not.toHaveBeenCalled()

    expect(runtimeStub.getOrStartRemoteTrackingBaseRefresh).toHaveBeenCalledWith(
      '/workspace/repo',
      remoteBase
    )
    expect(runtimeStub.fetchRemoteWithCache).not.toHaveBeenCalled()
    resolveFetch()
    const result = (await createPromise) as CreateWorktreeResult
    expect(addWorktreeMock).toHaveBeenCalled()
    expect(result.worktree.id).toBe('repo-1::/workspace/improve-dashboard')
    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/improve-dashboard',
      expect.objectContaining({ baseRef: 'refs/remotes/origin/main' })
    )
  })

  it('creates from the detected default base when the persisted base is stale', async () => {
    // Regression: a stale persisted repo base must fall back to the detected primary default instead of blocking creation.
    const remoteBase = {
      remote: 'origin',
      branch: 'main',
      ref: 'refs/remotes/origin/main',
      base: 'origin/main'
    }
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: '/workspace/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      worktreeBaseRef: 'origin/master'
    })
    runtimeStub.resolveRemoteTrackingBase.mockImplementation(async (_repoPath, baseBranch) =>
      baseBranch === 'origin/main' ? remoteBase : null
    )
    runtimeStub.hasRemoteTrackingRef.mockResolvedValue(true)
    runtimeStub.getOrStartRemoteTrackingBaseRefresh.mockResolvedValue({
      ok: true,
      errorKind: 'git_error'
    })
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard',
        head: 'created-sha',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (
        args[0] === 'rev-parse' &&
        (args.includes('refs/remotes/origin/master^{commit}') ||
          args.includes('refs/heads/origin/master^{commit}'))
      ) {
        throw new Error('missing ref')
      }
      return { stdout: 'created-sha\n', stderr: '' }
    })

    const result = (await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard'
    })) as CreateWorktreeResult

    expect(addWorktreeMock).toHaveBeenCalled()
    expect(runtimeStub.resolveRemoteTrackingBase).toHaveBeenCalledWith(
      '/workspace/repo',
      'origin/master'
    )
    expect(runtimeStub.resolveRemoteTrackingBase).toHaveBeenCalledWith(
      '/workspace/repo',
      'origin/main'
    )
    expect(runtimeStub.getOrStartRemoteTrackingBaseRefresh).toHaveBeenCalledWith(
      '/workspace/repo',
      remoteBase
    )
    expect(result.worktree.id).toBe('repo-1::/workspace/improve-dashboard')
  })

  it('keeps a usable persisted local branch base when a detected default exists', async () => {
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: '/workspace/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      worktreeBaseRef: 'develop'
    })
    runtimeStub.resolveRemoteTrackingBase.mockResolvedValue(null)
    runtimeStub.getOrStartRemoteTrackingBaseRefresh.mockResolvedValue({
      ok: false,
      errorKind: 'git_error'
    })
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard',
        head: 'created-sha',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args.includes('refs/heads/develop^{commit}')) {
        return { stdout: 'develop-sha\n', stderr: '' }
      }
      if (args[0] === 'fetch') {
        throw new Error('network unavailable')
      }
      return { stdout: 'created-sha\n', stderr: '' }
    })

    await expect(
      handlers['worktrees:create'](null, {
        repoId: 'repo-1',
        name: 'improve-dashboard'
      })
    ).resolves.toEqual(expect.objectContaining({ worktree: expect.any(Object) }))

    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/improve-dashboard',
      'improve-dashboard',
      'develop',
      false
    )
  })

  it('keeps a usable persisted slash-named local branch base that matches a remote prefix', async () => {
    const remoteBase = {
      remote: 'team',
      branch: 'feature',
      ref: 'refs/remotes/team/feature',
      base: 'team/feature'
    }
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: '/workspace/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      worktreeBaseRef: 'team/feature'
    })
    runtimeStub.resolveRemoteTrackingBase.mockImplementation(async (_repoPath, baseBranch) =>
      baseBranch === 'team/feature' ? remoteBase : null
    )
    runtimeStub.hasRemoteTrackingRef.mockResolvedValue(false)
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/slash-local-base',
        head: 'created-sha',
        branch: 'slash-local-base',
        isBare: false,
        isMainWorktree: false
      }
    ])
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args.includes('refs/remotes/team/feature^{commit}')) {
        throw new Error('missing remote-tracking ref')
      }
      if (args[0] === 'rev-parse' && args.includes('refs/heads/team/feature^{commit}')) {
        return { stdout: 'team-feature-sha\n', stderr: '' }
      }
      if (args[0] === 'fetch') {
        throw new Error('network unavailable')
      }
      return { stdout: 'created-sha\n', stderr: '' }
    })

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'slash-local-base'
    })

    expect(result).toEqual(expect.objectContaining({ worktree: expect.any(Object) }))
    expect((result as CreateWorktreeResult).baseFallback).toEqual({
      requestedRef: 'team/feature',
      localRef: 'team/feature'
    })
    expect(runtimeStub.getOrStartRemoteTrackingBaseRefresh).not.toHaveBeenCalled()
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/slash-local-base',
      'slash-local-base',
      'team/feature',
      false
    )
  })

  it('uses a local branch when its missing remote-tracking base cannot refresh', async () => {
    const remoteBase = {
      remote: 'origin',
      branch: 'main',
      ref: 'refs/remotes/origin/main',
      base: 'origin/main'
    }
    runtimeStub.resolveRemoteTrackingBase.mockResolvedValue(remoteBase)
    runtimeStub.hasRemoteTrackingRef.mockResolvedValue(false)
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/offline-local-main',
        head: 'created-sha',
        branch: 'offline-local-main',
        isBare: false,
        isMainWorktree: false
      }
    ])
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args.includes('refs/remotes/origin/main^{commit}')) {
        throw new Error('missing remote-tracking ref')
      }
      if (args[0] === 'rev-parse' && args.includes('refs/heads/main^{commit}')) {
        return { stdout: 'main-sha\n', stderr: '' }
      }
      if (args[0] === 'rev-parse') {
        return { stdout: '', stderr: '' }
      }
      return { stdout: 'created-sha\n', stderr: '' }
    })

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'offline-local-main',
      baseBranch: 'origin/main'
    })

    expect(result).toEqual(expect.objectContaining({ worktree: expect.any(Object) }))
    expect((result as CreateWorktreeResult).baseFallback).toEqual({
      requestedRef: 'origin/main',
      localRef: 'main'
    })
    expect(runtimeStub.getOrStartRemoteTrackingBaseRefresh).not.toHaveBeenCalled()
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/offline-local-main',
      'offline-local-main',
      'main',
      false
    )
  })

  it('keeps an explicit base strict when the pre-create refresh fails', async () => {
    const remoteBase = {
      remote: 'origin',
      branch: 'master',
      ref: 'refs/remotes/origin/master',
      base: 'origin/master'
    }
    runtimeStub.resolveRemoteTrackingBase.mockResolvedValue(remoteBase)
    runtimeStub.hasRemoteTrackingRef.mockResolvedValue(false)
    runtimeStub.getOrStartRemoteTrackingBaseRefresh.mockResolvedValue({
      ok: false,
      errorKind: 'git_error'
    })
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: '/workspace/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      worktreeBaseRef: 'origin/main'
    })

    await expect(
      handlers['worktrees:create'](null, {
        repoId: 'repo-1',
        name: 'improve-dashboard',
        baseBranch: 'origin/master'
      })
    ).rejects.toThrow(
      'Could not refresh base ref "origin/master" from "origin". Check your network and try again.'
    )

    expect(addWorktreeMock).not.toHaveBeenCalled()
    expect(resolveDefaultBaseRefViaExecMock).not.toHaveBeenCalled()
  })

  it('delegates remote-tracking base freshness to the runtime before create', async () => {
    const remoteBase = {
      remote: 'origin',
      branch: 'main',
      ref: 'refs/remotes/origin/main',
      base: 'origin/main'
    }
    runtimeStub.resolveRemoteTrackingBase.mockResolvedValue(remoteBase)
    runtimeStub.hasRemoteTrackingRef.mockResolvedValue(true)
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard',
        head: 'created-sha',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    gitExecFileAsyncMock.mockResolvedValue({ stdout: 'created-sha\n', stderr: '' })

    const result = (await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard'
    })) as CreateWorktreeResult

    expect(runtimeStub.getOrStartRemoteTrackingBaseRefresh).toHaveBeenCalledWith(
      '/workspace/repo',
      remoteBase
    )
    expect(result).toEqual(
      expect.objectContaining({
        worktree: expect.objectContaining({ id: 'repo-1::/workspace/improve-dashboard' })
      })
    )
  })

  it('threads the local base update suggestion from local create results', async () => {
    const remoteBase = {
      remote: 'origin',
      branch: 'main',
      ref: 'refs/remotes/origin/main',
      base: 'origin/main'
    }
    runtimeStub.resolveRemoteTrackingBase.mockResolvedValue(remoteBase)
    runtimeStub.hasRemoteTrackingRef.mockResolvedValue(true)
    addWorktreeMock.mockResolvedValue({
      localBaseRefUpdateSuggestion: {
        baseRef: 'origin/main',
        localBranch: 'main',
        behind: 2
      }
    })
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard',
        head: 'created-sha',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    gitExecFileAsyncMock.mockResolvedValue({ stdout: 'created-sha\n', stderr: '' })

    const result = (await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard'
    })) as CreateWorktreeResult

    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/improve-dashboard',
      'improve-dashboard',
      'origin/main',
      false,
      false,
      {
        suggestLocalBaseRefUpdate: true,
        remoteTrackingBase: {
          remote: 'origin',
          branch: 'main',
          ref: 'refs/remotes/origin/main',
          base: 'origin/main'
        }
      }
    )
    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/improve-dashboard',
      expect.objectContaining({ baseRef: 'refs/remotes/origin/main' })
    )
    expect(result.localBaseRefUpdateSuggestion).toEqual({
      baseRef: 'origin/main',
      localBranch: 'main',
      behind: 2
    })
  })

  it('throws a clear error when no default base ref can be resolved', async () => {
    // Why: guard against regressing to a silent 'origin/main' fallback; an unresolved default base must fail loudly, not hand a non-existent ref to `git worktree add`.
    resolveDefaultBaseRefWithLocalGitMock.mockResolvedValue(null)
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: '/workspace/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      worktreeBaseRef: null
    })

    await expect(
      handlers['worktrees:create'](null, {
        repoId: 'repo-1',
        name: 'improve-dashboard'
      })
    ).rejects.toThrow(/Could not resolve a default base ref/)
    expect(addWorktreeMock).not.toHaveBeenCalled()
  })

  it('creates an issue-command runner for an existing repo/worktree pair', async () => {
    const result = await handlers['hooks:createIssueCommandRunner'](null, {
      repoId: 'repo-1',
      worktreePath: '/workspace/improve-dashboard',
      command: 'codex exec "long command"'
    })

    expect(createIssueCommandRunnerScriptMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-1' }),
      '/workspace/improve-dashboard',
      'codex exec "long command"',
      {},
      // Why: issue runners take the resolved setup shell; it is undefined off Windows.
      undefined
    )
    expect(result).toMatchObject({
      runnerScriptPath: '/workspace/repo/.git/orca/issue-command-runner.sh',
      envVars: {
        ORCA_ROOT_PATH: '/workspace/repo',
        ORCA_WORKTREE_PATH: '/workspace/improve-dashboard'
      }
    })
  })

  it('lists a synthetic worktree for folder-mode repos', async () => {
    const rootWorktreeId = 'repo-1::/workspace/folder'
    const priorWorktreeIds = ['repo-1::/workspace/old-folder']
    const rootMeta = makeWorktreeMeta({
      instanceId: 'folder-instance',
      projectId: 'repo:repo-1',
      hostId: 'local',
      projectHostSetupId: 'repo-1',
      priorWorktreeIds
    })
    store.getRepos.mockReturnValue([
      {
        id: 'repo-1',
        path: '/workspace/folder',
        displayName: 'folder',
        badgeColor: '#000',
        addedAt: 0,
        kind: 'folder'
      }
    ])
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: '/workspace/folder',
      displayName: 'folder',
      badgeColor: '#000',
      addedAt: 0,
      kind: 'folder'
    })
    store.getAllWorktreeMeta.mockReturnValue({
      [rootWorktreeId]: rootMeta
    })
    store.getWorktreeMeta.mockImplementation((worktreeId: string) =>
      worktreeId === rootWorktreeId ? rootMeta : undefined
    )

    const listed = await handlers['worktrees:list'](null, { repoId: 'repo-1' })

    expect(listed).toEqual([
      expect.objectContaining({
        id: rootWorktreeId,
        repoId: 'repo-1',
        path: '/workspace/folder',
        displayName: 'folder',
        branch: '',
        head: '',
        isMainWorktree: true,
        priorWorktreeIds
      })
    ])
    expect(listWorktreesMock).not.toHaveBeenCalled()
  })

  it('keeps local listing failure behavior as an empty list', async () => {
    listWorktreesMock.mockRejectedValue(new Error('filesystem denied'))
    store.getAllWorktreeMeta.mockReturnValue({
      'repo-1::/workspace/feature-wt': makeWorktreeMeta({
        displayName: 'Should not appear'
      })
    })

    const listed = await handlers['worktrees:list'](null, { repoId: 'repo-1' })

    expect(listed).toEqual([])
    expect(store.getAllWorktreeMeta).not.toHaveBeenCalled()
  })

  it('stamps lastActivityAt on first discovery so newly-added worktrees sort to the top of Recent', async () => {
    // Why: a worktree on disk with no persisted WorktreeMeta would otherwise fall back to lastActivityAt: 0 and rank dead last in Recent.
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/discovered-wt',
        head: 'abc123',
        branch: 'refs/heads/feature',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.getWorktreeMeta.mockReturnValue(undefined)
    const stampedMeta = {
      projectId: 'repo:repo-1',
      hostId: 'local',
      projectHostSetupId: 'repo-1',
      lastActivityAt: 1_700_000_000_000
    }
    store.setWorktreeMeta.mockReturnValue(stampedMeta)

    const listed = (await handlers['worktrees:list'](null, { repoId: 'repo-1' })) as {
      id: string
      lastActivityAt: number
    }[]

    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/discovered-wt',
      expect.objectContaining({
        lastActivityAt: expect.any(Number),
        projectId: 'repo:repo-1',
        hostId: 'local',
        projectHostSetupId: 'repo-1'
      })
    )
    expect(listed[0]).toMatchObject({
      id: 'repo-1::/workspace/discovered-wt',
      lastActivityAt: 1_700_000_000_000
    })
  })

  it('backfills project-host ownership without re-stamping lastActivityAt for existing meta', async () => {
    // Why: only first discovery stamps (re-stamping would reshuffle the sidebar); host ownership is still backfilled since it derives from repo setup.
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/existing-wt',
        head: 'abc123',
        branch: 'refs/heads/feature',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.getWorktreeMeta.mockReturnValue({
      displayName: '',
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      instanceId: 'existing-instance',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 42
    })
    store.setWorktreeMeta.mockReturnValue({
      instanceId: 'existing-instance',
      projectId: 'repo:repo-1',
      hostId: 'local',
      projectHostSetupId: 'repo-1',
      lastActivityAt: 42
    })

    const listed = (await handlers['worktrees:list'](null, { repoId: 'repo-1' })) as {
      id: string
      lastActivityAt: number
      projectId?: string
      hostId?: string
      projectHostSetupId?: string
    }[]

    expect(store.setWorktreeMeta).toHaveBeenCalledWith('repo-1::/workspace/existing-wt', {
      projectId: 'repo:repo-1',
      hostId: 'local',
      projectHostSetupId: 'repo-1'
    })
    expect(listed[0].lastActivityAt).toBe(42)
    expect(listed[0]).toMatchObject({
      projectId: 'repo:repo-1',
      hostId: 'local',
      projectHostSetupId: 'repo-1'
    })
  })

  it('repairs legacy project ids when discovery now resolves the same host setup to a logical project', async () => {
    // Why: provider identity can arrive after metadata was written; existing workspaces must move to the logical project ID without losing activity ordering.
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/existing-wt',
        head: 'abc123',
        branch: 'refs/heads/feature',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.getProjectHostSetups.mockReturnValue([
      {
        id: 'repo-1',
        projectId: 'github:stablyai/orca',
        hostId: 'local',
        repoId: 'repo-1',
        path: '/workspace/repo',
        displayName: 'repo',
        setupState: 'ready',
        setupMethod: 'legacy-repo',
        createdAt: 0,
        updatedAt: 0
      }
    ])
    store.getWorktreeMeta.mockReturnValue({
      displayName: '',
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      instanceId: 'existing-instance',
      projectId: 'repo:repo-1',
      hostId: 'local',
      projectHostSetupId: 'repo-1',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 42
    })
    store.setWorktreeMeta.mockReturnValue({
      instanceId: 'existing-instance',
      projectId: 'github:stablyai/orca',
      hostId: 'local',
      projectHostSetupId: 'repo-1',
      lastActivityAt: 42
    })

    const listed = (await handlers['worktrees:list'](null, { repoId: 'repo-1' })) as {
      id: string
      lastActivityAt: number
      projectId?: string
      hostId?: string
      projectHostSetupId?: string
    }[]

    expect(store.setWorktreeMeta).toHaveBeenCalledWith('repo-1::/workspace/existing-wt', {
      projectId: 'github:stablyai/orca'
    })
    expect(listed[0]).toMatchObject({
      id: 'repo-1::/workspace/existing-wt',
      projectId: 'github:stablyai/orca',
      hostId: 'local',
      projectHostSetupId: 'repo-1',
      lastActivityAt: 42
    })
  })

  it('does not rewrite discovery metadata when instance and project-host ownership already exist', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/existing-wt',
        head: 'abc123',
        branch: 'refs/heads/feature',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.getWorktreeMeta.mockReturnValue({
      instanceId: 'existing-instance',
      projectId: 'repo:repo-1',
      hostId: 'local',
      projectHostSetupId: 'repo-1',
      displayName: '',
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 42
    })

    await handlers['worktrees:list'](null, { repoId: 'repo-1' })

    expect(store.setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('backfills instanceId on discovery for persisted metadata from older profiles', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/existing-wt',
        head: 'abc123',
        branch: 'refs/heads/feature',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.getWorktreeMeta.mockReturnValue({
      displayName: '',
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 42
    })
    store.setWorktreeMeta.mockReturnValue({
      instanceId: 'new-instance',
      projectId: 'repo:repo-1',
      hostId: 'local',
      projectHostSetupId: 'repo-1',
      lastActivityAt: 42
    })

    const listed = (await handlers['worktrees:list'](null, { repoId: 'repo-1' })) as {
      id: string
      instanceId?: string
    }[]

    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/existing-wt',
      expect.objectContaining({
        instanceId: expect.any(String),
        projectId: 'repo:repo-1',
        hostId: 'local',
        projectHostSetupId: 'repo-1'
      })
    )
    expect(listed[0]).toMatchObject({
      instanceId: 'new-instance',
      projectId: 'repo:repo-1',
      hostId: 'local',
      projectHostSetupId: 'repo-1'
    })
  })

  it('stamps lastActivityAt on first discovery for folder-mode repos', async () => {
    // Why: folder repos produce a synthetic worktree; without the stamp a just-added folder sorts to the bottom of Recent.
    store.getRepos.mockReturnValue([
      {
        id: 'repo-1',
        path: '/workspace/folder',
        displayName: 'folder',
        badgeColor: '#000',
        addedAt: 0,
        kind: 'folder'
      }
    ])
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: '/workspace/folder',
      displayName: 'folder',
      badgeColor: '#000',
      addedAt: 0,
      kind: 'folder'
    })
    store.getWorktreeMeta.mockReturnValue(undefined)
    store.setWorktreeMeta.mockReturnValue({
      projectId: 'repo:repo-1',
      hostId: 'local',
      projectHostSetupId: 'repo-1',
      lastActivityAt: 1_700_000_000_000
    })

    await handlers['worktrees:list'](null, { repoId: 'repo-1' })

    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/folder',
      expect.objectContaining({
        lastActivityAt: expect.any(Number),
        projectId: 'repo:repo-1',
        hostId: 'local',
        projectHostSetupId: 'repo-1'
      })
    )
  })

  it('stamps lastActivityAt on first discovery via worktrees:listAll', async () => {
    // Why: stamping logic is duplicated in worktrees:list and worktrees:listAll; a listAll regression would silently bury newly-discovered worktrees.
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/discovered-wt',
        head: 'abc123',
        branch: 'refs/heads/feature',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.getWorktreeMeta.mockReturnValue(undefined)
    store.setWorktreeMeta.mockReturnValue({ lastActivityAt: 1_700_000_000_000 })

    const listed = (await handlers['worktrees:listAll'](null, undefined)) as {
      id: string
      lastActivityAt: number
    }[]

    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/discovered-wt',
      expect.objectContaining({ lastActivityAt: expect.any(Number) })
    )
    expect(listed[0]).toMatchObject({
      id: 'repo-1::/workspace/discovered-wt',
      lastActivityAt: 1_700_000_000_000
    })
  })

  it('omits prunable worktrees from worktrees:listAll', async () => {
    // Why: a prunable registration has no working directory (issue #8389), so surfacing it yields repeated pty/fs failures and a blank pane.
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/repo',
        head: 'abc123',
        branch: 'refs/heads/main',
        isBare: false,
        isMainWorktree: true
      },
      {
        path: '/workspace/stale-wt',
        head: 'def456',
        branch: 'refs/heads/stale',
        isBare: false,
        prunable: true,
        prunableReason: 'gitdir file points to non-existent location',
        isMainWorktree: false
      },
      {
        path: '/workspace/live-wt',
        head: 'fed789',
        branch: 'refs/heads/live',
        isBare: false,
        isMainWorktree: false
      }
    ])
    store.getWorktreeMeta.mockReturnValue(undefined)
    store.setWorktreeMeta.mockReturnValue({ lastActivityAt: 1_700_000_000_000 })

    const listed = (await handlers['worktrees:listAll'](null, undefined)) as { id: string }[]
    const listedIds = listed.map((worktree) => worktree.id)

    expect(listedIds).toContain('repo-1::/workspace/live-wt')
    expect(listedIds).not.toContain('repo-1::/workspace/stale-wt')
  })

  it('limits concurrent repo scans in worktrees:listAll while preserving order', async () => {
    const repos = Array.from({ length: 10 }, (_, index) => ({
      id: `repo-${index}`,
      path: `/workspace/repo-${index}`,
      displayName: `repo-${index}`,
      badgeColor: '#000',
      addedAt: 0
    }))
    store.getRepos.mockReturnValue(repos)
    let activeScans = 0
    let maxActiveScans = 0
    let notifyScanStarted: (() => void) | undefined
    const waitForScanCount = async (count: number): Promise<void> => {
      while (listWorktreesMock.mock.calls.length < count) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error(`Timed out waiting for ${count} scans`)),
            1000
          )
          notifyScanStarted = () => {
            clearTimeout(timeout)
            resolve()
          }
        })
      }
    }
    const pendingScans: (() => void)[] = []
    listWorktreesMock.mockImplementation(
      async (
        repoPath: string
      ): Promise<
        { path: string; head: string; branch: string; isBare: false; isMainWorktree: true }[]
      > => {
        activeScans += 1
        maxActiveScans = Math.max(maxActiveScans, activeScans)
        await new Promise<void>((resolve) => {
          pendingScans.push(resolve)
          notifyScanStarted?.()
          notifyScanStarted = undefined
        })
        activeScans -= 1
        return [
          {
            path: repoPath,
            head: 'abc123',
            branch: 'refs/heads/main',
            isBare: false,
            isMainWorktree: true
          }
        ]
      }
    )

    const listPromise = handlers['worktrees:listAll'](null, undefined) as Promise<
      { path: string }[]
    >
    await Promise.resolve()

    expect(listWorktreesMock).toHaveBeenCalledTimes(8)
    expect(maxActiveScans).toBe(8)

    for (const resolve of pendingScans.splice(0)) {
      resolve()
    }
    await waitForScanCount(10)

    expect(listWorktreesMock).toHaveBeenCalledTimes(10)

    for (const resolve of pendingScans.splice(0)) {
      resolve()
    }
    const listed = await listPromise

    expect(maxActiveScans).toBe(8)
    expect(listed.map((worktree) => worktree.path)).toEqual(repos.map((repo) => repo.path))
  })

  it('skips past a suffix that already belongs to a PR after an initial branch conflict', async () => {
    // Why: the PR-conflict probe (network-bound, 1–3s) only runs from suffix=2 onward, after a branch collision already forced past the first candidate.
    getBranchConflictKindMock.mockImplementation(async (_repoPath: string, branch: string) =>
      branch === 'improve-dashboard' ? 'remote' : null
    )
    getPRForBranchMock.mockImplementation(async (_repoPath: string, branch: string) =>
      branch === 'improve-dashboard-2'
        ? {
            number: 3127,
            title: 'Existing PR',
            state: 'merged',
            url: 'https://example.com/pr/3127',
            checksStatus: 'success',
            updatedAt: '2026-04-01T00:00:00Z',
            mergeable: 'UNKNOWN'
          }
        : null
    )
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard-3',
        head: 'abc123',
        branch: 'improve-dashboard-3',
        isBare: false,
        isMainWorktree: false
      }
    ])

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard'
    })

    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/improve-dashboard-3',
      'improve-dashboard-3',
      'origin/main',
      false
    )
    expect(result).toMatchObject({
      worktree: expect.objectContaining({
        path: '/workspace/improve-dashboard-3',
        branch: 'improve-dashboard-3'
      })
    })
  })

  it('does not call `gh pr list` on the happy path (no branch conflict)', async () => {
    // Why: guard against a refactor reintroducing the PR probe on the happy path (1–3s GitHub round-trip per click).
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/improve-dashboard',
        head: 'abc123',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard'
    })

    expect(getPRForBranchMock).not.toHaveBeenCalled()
  })

  const createdWorktreeList = [
    {
      path: '/workspace/improve-dashboard',
      head: 'abc123',
      branch: 'improve-dashboard',
      isBare: false,
      isMainWorktree: false
    }
  ]

  it('returns a setup launch payload when setup should run', async () => {
    listWorktreesMock.mockResolvedValue(createdWorktreeList)
    getEffectiveHooksMock.mockReturnValue({
      scripts: {
        setup: 'pnpm worktree:setup'
      }
    })
    shouldRunSetupForCreateMock.mockReturnValue(true)

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      setupDecision: 'run'
    })

    expect(createSetupRunnerScriptMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-1' }),
      '/workspace/improve-dashboard',
      'pnpm worktree:setup',
      undefined,
      undefined
    )
    expect(result).toMatchObject({
      worktree: expect.objectContaining({
        repoId: 'repo-1',
        path: '/workspace/improve-dashboard',
        branch: 'improve-dashboard'
      }),
      setup: {
        runnerScriptPath: '/workspace/repo/.git/orca/setup-runner.sh',
        envVars: {
          ORCA_ROOT_PATH: '/workspace/repo',
          ORCA_WORKTREE_PATH: '/workspace/improve-dashboard'
        }
      }
    })
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/improve-dashboard',
      'improve-dashboard',
      'origin/main',
      false
    )
  })

  it('routes setup runner generation through the selected WSL project runtime', async () => {
    setPlatform('win32')
    store.getProjects.mockReturnValue([
      {
        id: 'project-1',
        displayName: 'repo',
        badgeColor: '#000',
        sourceRepoIds: ['repo-1'],
        localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' },
        createdAt: 0,
        updatedAt: 0
      }
    ])
    listWorktreesMock.mockResolvedValue(createdWorktreeList)
    getEffectiveHooksMock.mockReturnValue({
      scripts: {
        setup: 'pnpm worktree:setup'
      }
    })
    getEffectiveHooksFromConfigMock.mockReturnValue({
      scripts: {
        setup: 'pnpm worktree:setup'
      }
    })
    shouldRunSetupForCreateMock.mockReturnValue(true)

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      setupDecision: 'run'
    })

    expect(createSetupRunnerScriptMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-1' }),
      '/workspace/improve-dashboard',
      'pnpm worktree:setup',
      { wslDistro: 'Ubuntu' },
      undefined
    )
    expect(addWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/improve-dashboard',
      'improve-dashboard',
      'origin/main',
      false,
      false,
      { wslDistro: 'Ubuntu' }
    )
  })

  it('launches setup even when primary and worktree codev.yaml scripts diverge', async () => {
    // Why: benign codev.yaml divergence must not disable setup (regression from #1280 content-equality gate); repo trust already gates execution.
    listWorktreesMock.mockResolvedValue(createdWorktreeList)
    getEffectiveHooksMock.mockImplementation((_repo, worktreePath?: string) => ({
      scripts: {
        setup: worktreePath ? 'pnpm worktree:setup # worktree' : 'pnpm worktree:setup'
      }
    }))
    getEffectiveHooksFromConfigMock.mockReturnValue({
      scripts: {
        setup: 'pnpm worktree:setup # worktree'
      }
    })
    shouldRunSetupForCreateMock.mockReturnValue(true)

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      setupDecision: 'run'
    })

    expect(createSetupRunnerScriptMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-1' }),
      '/workspace/improve-dashboard',
      'pnpm worktree:setup # worktree',
      undefined,
      undefined
    )
    expect(result).toEqual(
      expect.objectContaining({
        setup: expect.objectContaining({
          runnerScriptPath: '/workspace/repo/.git/orca/setup-runner.sh'
        })
      })
    )
  })

  it('creates a sparse worktree and persists its sparse metadata', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        ...createdWorktreeList[0],
        isSparse: true
      }
    ])
    store.setWorktreeMeta.mockReturnValue({
      sparseDirectories: ['packages/web', 'apps/api'],
      sparseBaseRef: 'origin/main',
      sparsePresetId: 'preset-1'
    })
    store.getSparsePresets.mockReturnValue([
      {
        id: 'preset-1',
        repoId: 'repo-1',
        name: 'Frontend and API',
        directories: ['packages/web', 'apps/api'],
        createdAt: 1,
        updatedAt: 1
      }
    ])

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      sparseCheckout: {
        directories: [' packages/web ', 'apps\\api\\', 'packages/web/'],
        presetId: 'preset-1'
      }
    })

    expect(addWorktreeMock).not.toHaveBeenCalled()
    expect(addSparseWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/improve-dashboard',
      'improve-dashboard',
      ['packages/web', 'apps/api'],
      'origin/main',
      false
    )
    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/improve-dashboard',
      expect.objectContaining({
        sparseDirectories: ['packages/web', 'apps/api'],
        sparseBaseRef: 'origin/main',
        sparsePresetId: 'preset-1'
      })
    )
    expect(result).toMatchObject({
      worktree: expect.objectContaining({
        repoId: 'repo-1',
        path: '/workspace/improve-dashboard',
        sparseDirectories: ['packages/web', 'apps/api'],
        sparseBaseRef: 'origin/main',
        sparsePresetId: 'preset-1'
      })
    })
  })

  it('clears sparse preset attribution when the preset id does not belong to the repo', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        ...createdWorktreeList[0],
        isSparse: true
      }
    ])
    store.getSparsePresets.mockReturnValue([
      {
        id: 'preset-2',
        repoId: 'repo-1',
        name: 'Other preset',
        directories: ['packages/web'],
        createdAt: 1,
        updatedAt: 1
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      sparseCheckout: {
        directories: ['packages/web'],
        presetId: 'preset-1'
      }
    })

    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/improve-dashboard',
      expect.objectContaining({
        sparseDirectories: ['packages/web'],
        sparseBaseRef: 'origin/main',
        sparsePresetId: undefined
      })
    )
  })

  it('clears sparse preset attribution when normalized directories do not match', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        ...createdWorktreeList[0],
        isSparse: true
      }
    ])
    store.getSparsePresets.mockReturnValue([
      {
        id: 'preset-1',
        repoId: 'repo-1',
        name: 'Frontend and API',
        directories: ['packages/web', 'apps/api'],
        createdAt: 1,
        updatedAt: 1
      }
    ])

    await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      sparseCheckout: {
        directories: ['packages/web'],
        presetId: 'preset-1'
      }
    })

    expect(store.setWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/improve-dashboard',
      expect.objectContaining({
        sparseDirectories: ['packages/web'],
        sparseBaseRef: 'origin/main',
        sparsePresetId: undefined
      })
    )
  })

  it('rejects sparse checkout directories that traverse above the repo root', async () => {
    await expect(
      handlers['worktrees:create'](null, {
        repoId: 'repo-1',
        name: 'improve-dashboard',
        sparseCheckout: {
          directories: ['packages/web', '../secrets']
        }
      })
    ).rejects.toThrow('Sparse checkout directories must be repo-relative paths.')

    expect(addSparseWorktreeMock).not.toHaveBeenCalled()
    expect(addWorktreeMock).not.toHaveBeenCalled()
  })

  it.each(['/Users/me/repo/packages/web', 'C:\\repo\\packages\\web', '\\\\server\\share\\repo'])(
    'rejects absolute sparse checkout directory before normalization: %s',
    async (directory) => {
      await expect(
        handlers['worktrees:create'](null, {
          repoId: 'repo-1',
          name: 'improve-dashboard',
          sparseCheckout: {
            directories: ['packages/web', directory]
          }
        })
      ).rejects.toThrow('Sparse checkout directories must be repo-relative paths.')

      expect(addSparseWorktreeMock).not.toHaveBeenCalled()
      expect(addWorktreeMock).not.toHaveBeenCalled()
    }
  )

  it('still returns the created worktree when setup runner generation fails', async () => {
    listWorktreesMock.mockResolvedValue(createdWorktreeList)
    getEffectiveHooksMock.mockReturnValue({
      scripts: {
        setup: 'pnpm worktree:setup'
      }
    })
    shouldRunSetupForCreateMock.mockReturnValue(true)
    createSetupRunnerScriptMock.mockImplementation(() => {
      throw new Error('disk full')
    })

    const result = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard',
      setupDecision: 'run'
    })

    expect(result).toMatchObject({
      worktree: expect.objectContaining({
        repoId: 'repo-1',
        path: '/workspace/improve-dashboard',
        branch: 'improve-dashboard'
      })
    })
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('worktrees:changed', {
      repoId: 'repo-1'
    })
  })

  it('traces the removal as worktree.remove with a stage sub-span tree', async () => {
    const records: RedactableSpan[] = []
    setActiveSink({
      push: (record) => records.push(record as RedactableSpan),
      flush: () => {},
      close: () => {}
    })
    try {
      mockKnownFeatureWorktree()
      getEffectiveHooksMock.mockReturnValue(null)
      removeWorktreeMock.mockResolvedValue({})

      await handlers['worktrees:remove'](null, { worktreeId: 'repo-1::/workspace/feature-wt' })

      const parent = records.find((record) => record.name === 'worktree.remove')
      expect(parent).toBeDefined()
      expect(parent?.attributes).toMatchObject({
        kind: 'worktree',
        'worktree.stage': 'remove',
        'worktree.path': '/workspace/feature-wt'
      })
      const stages = records.filter((record) => record.name.startsWith('worktree.remove.'))
      expect(stages.map((record) => record.name)).toEqual(
        expect.arrayContaining([
          'worktree.remove.watcher_gate',
          'worktree.remove.pty_sweep',
          'worktree.remove.git_remove',
          'worktree.remove.metadata_purge',
          'worktree.remove.cache_invalidation'
        ])
      )
      // Stages must hang off the removal span, not float as roots, or a freeze can't be attributed.
      for (const stage of stages) {
        expect(stage.parentSpanId).toBe(parent?.spanId)
        expect(stage.attributes).toMatchObject({ kind: 'worktree', 'worktree.flow': 'local' })
      }
    } finally {
      _resetTracerForTests()
    }
  })

  it('traces a local archive hook as flow local, not remote', async () => {
    const records: RedactableSpan[] = []
    setActiveSink({
      push: (record) => records.push(record as RedactableSpan),
      flush: () => {},
      close: () => {}
    })
    try {
      mockKnownFeatureWorktree()
      // The archive hook block is shared by both flows, so a local repo must not land under 'remote'.
      getEffectiveHooksMock.mockReturnValue({ scripts: { archive: 'pnpm worktree:archive' } })
      runHookMock.mockResolvedValue({ success: true, output: '' })
      removeWorktreeMock.mockResolvedValue({})

      await handlers['worktrees:remove'](null, { worktreeId: 'repo-1::/workspace/feature-wt' })

      const archiveStage = records.find((record) => record.name === 'worktree.remove.archive_hook')
      expect(archiveStage?.attributes).toMatchObject({
        kind: 'worktree',
        'worktree.flow': 'local'
      })
    } finally {
      _resetTracerForTests()
    }
  })

  it('prunes git worktree tracking when removing an orphaned worktree', async () => {
    mockKnownFeatureWorktree()
    const orphanError = Object.assign(new Error('git worktree remove failed'), {
      stderr: "fatal: '/workspace/feature-wt' is not a working tree"
    })
    removeWorktreeMock.mockRejectedValue(orphanError)
    getEffectiveHooksMock.mockReturnValue(null)
    gitExecFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    })

    // Should have called git worktree prune to clean up stale tracking
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(['worktree', 'prune'], {
      cwd: '/workspace/repo'
    })
    expect(store.removeWorktreeMeta).toHaveBeenCalledWith('repo-1::/workspace/feature-wt', 'local')
    expect(deleteWorktreeHistoryDirMock).toHaveBeenCalledWith('repo-1::/workspace/feature-wt')
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('worktrees:changed', {
      repoId: 'repo-1'
    })
  })

  it('recovers forced Windows long-path worktree removal through local deletion and prune', async () => {
    setPlatform('win32')
    const parentDir = await mkdtemp(join(tmpdir(), 'orca-ipc-long-path-'))
    const repoPath = join(parentDir, 'repo')
    const worktreePath = join(parentDir, 'feature-wt')
    await mkdir(worktreePath, { recursive: true })
    await writeFile(join(worktreePath, 'scratch.txt'), 'delete me')
    const registeredWorktrees = mockKnownFeatureWorktree(worktreePath, repoPath)
    listWorktreesMock
      .mockResolvedValueOnce(registeredWorktrees)
      .mockResolvedValueOnce(registeredWorktrees)
      .mockResolvedValue([])
    store.getWorktreeMeta.mockReturnValue(makeWorktreeMeta())
    const longPathError = Object.assign(new Error('git worktree remove failed'), {
      stderr: 'error: failed to delete deep/file.txt: Filename too long'
    })
    removeWorktreeMock.mockRejectedValue(longPathError)
    const worktreeId = `repo-1::${worktreePath}`

    try {
      const result = await handlers['worktrees:remove'](null, {
        worktreeId,
        force: true
      })

      expect(result).toEqual({
        preservedBranch: { branchName: 'feature', head: 'feature' }
      })
      if (ORIGINAL_PLATFORM === 'win32') {
        await expect(lstat(worktreePath)).rejects.toMatchObject({ code: 'ENOENT' })
      }
      expect(gitExecFileAsyncMock).toHaveBeenCalledWith(['worktree', 'prune'], {
        cwd: '/workspace/repo'
      })
      expect(store.removeWorktreeMeta).toHaveBeenCalledWith(worktreeId, 'local')
      expect(mainWindow.webContents.send).toHaveBeenCalledWith('worktrees:changed', {
        repoId: 'repo-1'
      })
    } finally {
      await rm(parentDir, { recursive: true, force: true })
    }
  })

  it('does not create a preserved-branch target when long-path recovery preserves branch by policy', async () => {
    setPlatform('win32')
    const registeredWorktrees = mockKnownFeatureWorktree()
    listWorktreesMock
      .mockResolvedValueOnce(registeredWorktrees)
      .mockResolvedValueOnce(registeredWorktrees)
      .mockResolvedValue([])
    store.getWorktreeMeta.mockReturnValue(makeWorktreeMeta({ preserveBranchOnDelete: true }))
    removeWorktreeMock.mockRejectedValue(
      Object.assign(new Error('git worktree remove failed'), {
        stderr: 'error: failed to delete deep/file.txt: Filename too long'
      })
    )

    const result = await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt',
      force: true
    })

    expect(result).toEqual({})
    await expect(
      handlers['worktrees:forceDeletePreservedBranch'](null, {
        worktreeId: 'repo-1::/workspace/feature-wt',
        branchName: 'feature',
        expectedHead: 'feature'
      })
    ).rejects.toThrow('No preserved branch cleanup is pending')
  })

  it('does not recover Windows long-path worktree removal without force', async () => {
    setPlatform('win32')
    mockKnownFeatureWorktree()
    const longPathError = Object.assign(new Error('git worktree remove failed'), {
      stderr: 'error: failed to delete deep/file.txt: Filename too long'
    })
    removeWorktreeMock.mockRejectedValue(longPathError)

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/feature-wt'
      })
    ).rejects.toThrow('Failed to delete worktree at /workspace/feature-wt.')

    expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
  })

  it('refuses Windows recovery while Git still reports the row and keeps metadata', async () => {
    setPlatform('win32')
    mockKnownFeatureWorktree()
    store.getWorktreeMeta.mockReturnValue(makeWorktreeMeta())
    const removePathSpy = vi
      .spyOn(localWorktreeFilesystem, 'removeLocalWorktreePath')
      .mockResolvedValue(undefined)
    removeWorktreeMock.mockRejectedValue(
      Object.assign(new Error('git worktree remove failed'), {
        stderr: 'error: failed to delete deep/file.txt: Filename too long'
      })
    )

    try {
      await expect(
        handlers['worktrees:remove'](null, {
          worktreeId: 'repo-1::/workspace/feature-wt',
          force: true
        })
      ).rejects.toThrow(
        'Failed to force delete worktree at /workspace/feature-wt. error: failed to delete deep/file.txt: Filename too long'
      )

      expect(removePathSpy).not.toHaveBeenCalled()
      expect(gitExecFileAsyncMock).not.toHaveBeenCalledWith(
        ['worktree', 'prune'],
        expect.anything()
      )
      expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
      expect(mainWindow.webContents.send).not.toHaveBeenCalledWith('worktrees:changed', {
        repoId: 'repo-1'
      })
    } finally {
      removePathSpy.mockRestore()
    }
  })

  it('retries stale Git registration cleanup after prior local filesystem recovery', async () => {
    setPlatform('win32')
    const missingWorktreePath = 'C:\\workspace\\already-removed'
    const worktreeId = `repo-1::${missingWorktreePath}`
    const registeredWorktrees = mockKnownFeatureWorktree(missingWorktreePath)
    listWorktreesMock.mockResolvedValueOnce(registeredWorktrees).mockResolvedValue([])
    store.getWorktreeMeta.mockReturnValue(makeWorktreeMeta())

    const result = await handlers['worktrees:remove'](null, {
      worktreeId,
      force: true
    })

    expect(result).toEqual({
      preservedBranch: { branchName: 'feature', head: 'feature' }
    })
    expect(runHookMock).not.toHaveBeenCalled()
    expect(killAllProcessesForWorktreeMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(['worktree', 'prune'], {
      cwd: '/workspace/repo'
    })
    expect(store.removeWorktreeMeta).toHaveBeenCalledWith(worktreeId, 'local')
  })

  it('preserves a locked missing registration even with force', async () => {
    setPlatform('win32')
    const missingWorktreePath = 'C:\\workspace\\locked-already-removed'
    const worktreeId = `repo-1::${missingWorktreePath}`
    const registeredWorktrees: GitWorktreeInfo[] = [
      {
        path: '/workspace/repo',
        head: 'main',
        branch: 'main',
        isBare: false,
        isMainWorktree: true
      },
      {
        path: missingWorktreePath,
        head: 'feature',
        branch: 'feature',
        isBare: false,
        isMainWorktree: false,
        locked: true,
        lockReason: 'active agent session'
      }
    ]
    listWorktreesMock.mockResolvedValue(registeredWorktrees)
    store.getWorktreeMeta.mockReturnValue(makeWorktreeMeta())
    removeWorktreeMock.mockResolvedValue({})

    await expect(handlers['worktrees:remove'](null, { worktreeId, force: true })).rejects.toThrow(
      'Worktree is locked by Git. Lock reason: active agent session'
    )

    expect(removeWorktreeMock).not.toHaveBeenCalled()
    expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
  })

  it('refuses to delete the root workspace for folder-mode repos', async () => {
    store.getRepo.mockReturnValue({
      id: 'repo-folder',
      path: '/workspace/folder',
      displayName: 'folder',
      badgeColor: '#000',
      addedAt: 0,
      kind: 'folder'
    })

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-folder::/workspace/folder'
      })
    ).rejects.toThrow('Cannot delete the project root workspace')

    expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
    expect(deleteWorktreeHistoryDirMock).not.toHaveBeenCalled()
  })

  it('kills PTYs before removing additional folder workspace metadata', async () => {
    const ptyProvider = {} as never
    const worktreeId = 'repo-folder::/workspace/folder::workspace:child-1'
    store.getRepo.mockReturnValue({
      id: 'repo-folder',
      path: '/workspace/folder',
      displayName: 'folder',
      badgeColor: '#000',
      addedAt: 0,
      kind: 'folder'
    })
    getLocalPtyProviderMock.mockReturnValue(ptyProvider)

    await handlers['worktrees:remove'](null, { worktreeId })

    expect(killAllProcessesForWorktreeMock).toHaveBeenCalledWith(worktreeId, {
      runtime: runtimeStub,
      resolvedWorktreeId: worktreeId,
      localProvider: ptyProvider,
      onPtyStopped: clearProviderPtyStateMock
    })
    expect(killAllProcessesForWorktreeMock.mock.invocationCallOrder[0]).toBeLessThan(
      store.removeWorktreeMeta.mock.invocationCallOrder[0]
    )
    expect(store.removeWorktreeMeta).toHaveBeenCalledWith(worktreeId, 'local')
    expect(advertisedUrlWatcherForgetWorktreeMock).toHaveBeenCalledWith(worktreeId)
    expect(deleteWorktreeHistoryDirMock).toHaveBeenCalledWith(worktreeId)
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('worktrees:changed', {
      repoId: 'repo-folder'
    })
  })

  // Folder projects can be SSH-backed, and folder workspace ids are `repoId::path::workspace:<uuid>`
  // — reusable across hosts — so the sweep must name the owning connection.
  it('runs the archive hook on remove when skipArchive is not set', async () => {
    mockKnownFeatureWorktree()
    removeWorktreeMock.mockResolvedValue(undefined)
    getEffectiveHooksMock.mockReturnValue({
      scripts: {
        archive: 'echo archived'
      }
    })
    runHookMock.mockResolvedValue({ success: true, output: '' })

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    })

    expect(runHookMock).toHaveBeenCalledWith(
      'archive',
      '/workspace/feature-wt',
      expect.objectContaining({ id: 'repo-1' }),
      undefined,
      {}
    )
    expect(removeWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/feature-wt',
      false,
      expect.objectContaining({
        knownRemovedWorktree: expect.objectContaining({
          branch: 'feature',
          head: 'feature',
          path: '/workspace/feature-wt'
        })
      })
    )
  })

  it('passes project shared links through the IPC removal preflight and cleanup', async () => {
    mockKnownFeatureWorktree()
    loadHooksMock.mockReturnValue({
      worktree: { sharedDirectories: ['node_modules'] }
    })
    findExistingWorktreeSymlinkPathsMock.mockResolvedValue(['node_modules'])
    removeWorktreeMock.mockResolvedValue({})

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    })

    expect(findExistingWorktreeSymlinkPathsMock).toHaveBeenCalledWith('/workspace/feature-wt', [
      'node_modules'
    ])
    expect(assertWorktreeCleanForRemovalMock).toHaveBeenCalledWith('/workspace/feature-wt', false, {
      ignoredUntrackedPaths: ['node_modules']
    })
    expect(removeWorktreeLinkedPathsMock).toHaveBeenCalledWith('/workspace/feature-wt', [
      'node_modules'
    ])
    // Why order matters: linked-path deletion is destructive, so PTYs must release every handle
    // before Windows or WSL filesystem cleanup starts (mirrors the runtime removal path).
    expect(killAllProcessesForWorktreeMock).toHaveBeenCalled()
    // Latest PTY sweep vs earliest deletion: a later sweep would mean handles were still open.
    expect(Math.max(...killAllProcessesForWorktreeMock.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...removeWorktreeLinkedPathsMock.mock.invocationCallOrder)
    )
  })

  it('does not remove a worktree when watcher teardown cannot release it', async () => {
    mockKnownFeatureWorktree()
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: '/workspace/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      symlinkPaths: ['node_modules']
    })
    runtimeStub.closeFileWatchersForRemoval.mockRejectedValue(
      new Error('file watcher process did not exit after termination deadline')
    )

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/feature-wt'
      })
    ).rejects.toThrow('file watcher process did not exit after termination deadline')

    expect(removeWorktreeMock).not.toHaveBeenCalled()
    expect(removeWorktreeLinkedPathsMock).not.toHaveBeenCalled()
    expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
  })

  it('releases the watcher-install fence when worktree deletion fails', async () => {
    mockKnownFeatureWorktree()
    const finish = vi.fn().mockResolvedValue(undefined)
    runtimeStub.acquireFileWatcherRemoval.mockResolvedValueOnce({
      finish
    })
    removeWorktreeMock.mockRejectedValueOnce(new Error('delete failed'))

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/feature-wt'
      })
    ).rejects.toThrow('delete failed')

    expect(finish).toHaveBeenCalledWith(false)
    expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
  })

  it('skips the archive hook on remove when skipArchive is true', async () => {
    mockKnownFeatureWorktree()
    removeWorktreeMock.mockResolvedValue(undefined)
    getEffectiveHooksMock.mockReturnValue({
      scripts: {
        archive: 'echo archived'
      }
    })
    runHookMock.mockResolvedValue({ success: true, output: '' })

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt',
      skipArchive: true
    })

    expect(runHookMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/feature-wt',
      false,
      expect.objectContaining({
        knownRemovedWorktree: expect.objectContaining({
          branch: 'feature',
          head: 'feature',
          path: '/workspace/feature-wt'
        })
      })
    )
  })

  it('preserves the branch on remove for worktrees created from an existing local branch', async () => {
    mockKnownFeatureWorktree()
    removeWorktreeMock.mockResolvedValue(undefined)
    store.getWorktreeMeta.mockReturnValue(makeWorktreeMeta({ preserveBranchOnDelete: true }))

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    })

    expect(removeWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/feature-wt',
      false,
      expect.objectContaining({
        deleteBranch: false,
        knownRemovedWorktree: expect.objectContaining({
          branch: 'feature',
          head: 'feature',
          path: '/workspace/feature-wt'
        })
      })
    )
  })

  it('force-deletes a branch that was preserved by safe worktree removal', async () => {
    mockKnownFeatureWorktree()
    removeWorktreeMock.mockResolvedValue({
      preservedBranch: { branchName: 'feature/test', head: 'def456' }
    })

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    })
    const result = await handlers['worktrees:forceDeletePreservedBranch'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt',
      branchName: 'feature/test',
      expectedHead: 'def456'
    })

    expect(result).toMatchObject({ deleted: true })
    expect(forceDeleteLocalBranchMock).toHaveBeenCalledWith(
      '/workspace/repo',
      'feature/test',
      'def456'
    )
  })

  it('rejects stale preserved-branch cleanup actions with an old head', async () => {
    mockKnownFeatureWorktree()
    removeWorktreeMock.mockResolvedValue({
      preservedBranch: { branchName: 'feature/test', head: 'new456' }
    })

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    })

    await expect(
      handlers['worktrees:forceDeletePreservedBranch'](null, {
        worktreeId: 'repo-1::/workspace/feature-wt',
        branchName: 'feature/test',
        expectedHead: 'old123'
      })
    ).rejects.toThrow('No preserved branch cleanup is pending')
    expect(forceDeleteLocalBranchMock).not.toHaveBeenCalled()
  })

  it('removes an unused Orca-created fork remote after deleting its worktree', async () => {
    mockKnownFeatureWorktree()
    removeWorktreeMock.mockResolvedValue(undefined)
    const pushTarget = {
      remoteName: 'pr-contributor-orca',
      branchName: 'feature/from-fork',
      remoteUrl: 'https://github.com/contributor/orca.git',
      remoteCreated: true
    }
    store.getWorktreeMeta.mockReturnValue(makeWorktreeMeta({ pushTarget }))
    store.getAllWorktreeMeta.mockReturnValue({
      'repo-1::/workspace/feature-wt': makeWorktreeMeta({ pushTarget })
    })
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'config') {
        throw new Error('no branch config')
      }
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'https://github.com/contributor/orca.git\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(['remote', 'remove', 'pr-contributor-orca'], {
      cwd: '/workspace/repo'
    })
  })

  it('keeps an Orca-created fork remote while another worktree still uses it', async () => {
    mockKnownFeatureWorktree()
    removeWorktreeMock.mockResolvedValue(undefined)
    const pushTarget = {
      remoteName: 'pr-contributor-orca',
      branchName: 'feature/from-fork',
      remoteUrl: 'https://github.com/contributor/orca.git',
      remoteCreated: true
    }
    store.getWorktreeMeta.mockReturnValue(makeWorktreeMeta({ pushTarget }))
    store.getAllWorktreeMeta.mockReturnValue({
      'repo-1::/workspace/feature-wt': makeWorktreeMeta({ pushTarget }),
      'repo-1::/workspace/other-wt': makeWorktreeMeta({
        pushTarget: {
          ...pushTarget,
          branchName: 'other-branch'
        }
      })
    })

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    })

    expect(gitExecFileAsyncMock).not.toHaveBeenCalledWith(
      ['remote', 'remove', 'pr-contributor-orca'],
      expect.any(Object)
    )
  })

  it('ignores matching push targets from other repos when deciding fork remote cleanup', async () => {
    mockKnownFeatureWorktree()
    removeWorktreeMock.mockResolvedValue(undefined)
    const pushTarget = {
      remoteName: 'pr-contributor-orca',
      branchName: 'feature/from-fork',
      remoteUrl: 'https://github.com/contributor/orca.git',
      remoteCreated: true
    }
    store.getWorktreeMeta.mockReturnValue(makeWorktreeMeta({ pushTarget }))
    store.getAllWorktreeMeta.mockReturnValue({
      'repo-1::/workspace/feature-wt': makeWorktreeMeta({ pushTarget }),
      'repo-2::/workspace/other-wt': makeWorktreeMeta({
        pushTarget: {
          ...pushTarget,
          branchName: 'other-branch'
        }
      })
    })
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'config') {
        throw new Error('no branch config')
      }
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'https://github.com/contributor/orca.git\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(['remote', 'remove', 'pr-contributor-orca'], {
      cwd: '/workspace/repo'
    })
  })

  it('reports already-missing unregistered delete paths before teardown, hooks, or git removal', async () => {
    mockKnownFeatureWorktree('/workspace/real-feature')
    getEffectiveHooksMock.mockReturnValue({
      scripts: {
        archive: 'echo archived'
      }
    })

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/not-a-worktree'
      })
    ).rejects.toThrow(
      'Worktree is no longer registered with Git and its directory is already gone.'
    )

    expect(killAllProcessesForWorktreeMock).not.toHaveBeenCalled()
    expect(runHookMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
    expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
  })

  it('treats forced deletion of an already-missing unregistered worktree as cleanup', async () => {
    mockKnownFeatureWorktree('/workspace/real-feature')

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/already-deleted-wt',
      force: true
    })

    expect(killAllProcessesForWorktreeMock).not.toHaveBeenCalled()
    expect(runHookMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
    expect(runtimeStub.clearOptimisticReconcileToken).toHaveBeenCalledWith(
      'repo-1::/workspace/already-deleted-wt'
    )
    expect(store.removeWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/already-deleted-wt',
      'local'
    )
    expect(deleteWorktreeHistoryDirMock).toHaveBeenCalledWith(
      'repo-1::/workspace/already-deleted-wt'
    )
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('worktrees:changed', {
      repoId: 'repo-1'
    })
  })

  it('cleans up an already-missing unregistered worktree after force recovery', async () => {
    const worktreeId = 'repo-1::/workspace/already-deleted-wt'
    mockKnownFeatureWorktree('/workspace/real-feature')

    await expect(handlers['worktrees:remove'](null, { worktreeId })).rejects.toThrow(
      'Worktree is no longer registered with Git and its directory is already gone.'
    )

    await handlers['worktrees:remove'](null, { worktreeId, force: true })

    expect(killAllProcessesForWorktreeMock).not.toHaveBeenCalled()
    expect(runHookMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
    expect(runtimeStub.clearOptimisticReconcileToken).toHaveBeenCalledWith(worktreeId)
    expect(store.removeWorktreeMeta).toHaveBeenCalledWith(worktreeId, 'local')
    expect(deleteWorktreeHistoryDirMock).toHaveBeenCalledWith(worktreeId)
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('worktrees:changed', {
      repoId: 'repo-1'
    })
  })

  it('treats normal deletion of an already-missing unregistered worktree as cleanup', async () => {
    mockKnownFeatureWorktree('/workspace/real-feature')
    store.getWorktreeMeta.mockReturnValue(makeWorktreeMeta())

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/already-deleted-wt'
    })

    expect(killAllProcessesForWorktreeMock).not.toHaveBeenCalled()
    expect(runHookMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
    expect(runtimeStub.clearOptimisticReconcileToken).toHaveBeenCalledWith(
      'repo-1::/workspace/already-deleted-wt'
    )
    expect(store.removeWorktreeMeta).toHaveBeenCalledWith(
      'repo-1::/workspace/already-deleted-wt',
      'local'
    )
    expect(deleteWorktreeHistoryDirMock).toHaveBeenCalledWith(
      'repo-1::/workspace/already-deleted-wt'
    )
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('worktrees:changed', {
      repoId: 'repo-1'
    })
  })

  it('force-removes a legacy Orca-created orphaned worktree directory after Git tracking is gone', async () => {
    const parentDir = await mkdtemp(join(tmpdir(), 'orca-ipc-orphan-'))
    const repoPath = join(parentDir, 'repo')
    const orphanPath = join(parentDir, 'orphan')
    const adminWorktreePath = join(repoPath, '.git', 'worktrees', 'orphan')
    const worktreeId = `repo-1::${orphanPath}`
    await mkdir(orphanPath, { recursive: true })
    await mkdir(adminWorktreePath, { recursive: true })
    await writeFile(join(orphanPath, '.git'), `gitdir: ${adminWorktreePath}\n`)
    await writeFile(join(adminWorktreePath, 'gitdir'), `${join(orphanPath, '.git')}\n`)
    const repo = {
      id: 'repo-1',
      path: repoPath,
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      worktreeBaseRef: null
    }
    store.getRepo.mockReturnValue(repo)
    store.getRepos.mockReturnValue([repo])
    mockKnownFeatureWorktree(join(parentDir, 'real-feature'), repoPath)
    store.getWorktreeMeta.mockReturnValue(makeWorktreeMeta({ createdAt: Date.now() }))

    try {
      await handlers['worktrees:remove'](null, {
        worktreeId,
        force: true
      })

      await expect(lstat(orphanPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(killAllProcessesForWorktreeMock).toHaveBeenCalledWith(
        worktreeId,
        expect.objectContaining({ requirePhysicalStop: true })
      )
      expect(runHookMock).not.toHaveBeenCalled()
      expect(removeWorktreeMock).not.toHaveBeenCalled()
      expect(runtimeStub.clearOptimisticReconcileToken).toHaveBeenCalledWith(worktreeId)
      expect(store.removeWorktreeMeta).toHaveBeenCalledWith(worktreeId, 'local')
      expect(deleteWorktreeHistoryDirMock).toHaveBeenCalledWith(worktreeId)
      expect(mainWindow.webContents.send).toHaveBeenCalledWith('worktrees:changed', {
        repoId: 'repo-1'
      })
    } finally {
      await rm(parentDir, { recursive: true, force: true })
    }
  })

  it('prompts for force before removing an Orca-created orphaned worktree directory', async () => {
    const parentDir = await mkdtemp(join(tmpdir(), 'orca-ipc-orphan-'))
    const repoPath = join(parentDir, 'repo')
    const orphanPath = join(parentDir, 'orphan')
    const adminWorktreePath = join(repoPath, '.git', 'worktrees', 'orphan')
    await mkdir(orphanPath, { recursive: true })
    await mkdir(adminWorktreePath, { recursive: true })
    await writeFile(join(orphanPath, '.git'), `gitdir: ${adminWorktreePath}\n`)
    await writeFile(join(adminWorktreePath, 'gitdir'), `${join(orphanPath, '.git')}\n`)
    const repo = {
      id: 'repo-1',
      path: repoPath,
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      worktreeBaseRef: null
    }
    store.getRepo.mockReturnValue(repo)
    store.getRepos.mockReturnValue([repo])
    mockKnownFeatureWorktree(join(parentDir, 'real-feature'), repoPath)
    store.getWorktreeMeta.mockReturnValue(
      makeWorktreeMeta({ orcaCreatedAt: Date.now(), orcaCreationSource: 'runtime' })
    )

    try {
      await expect(
        handlers['worktrees:remove'](null, {
          worktreeId: `repo-1::${orphanPath}`
        })
      ).rejects.toThrow('Worktree is no longer registered with Git but its directory remains.')

      await expect(lstat(orphanPath)).resolves.toBeTruthy()
      expect(removeWorktreeMock).not.toHaveBeenCalled()
      expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
    } finally {
      await rm(parentDir, { recursive: true, force: true })
    }
  })

  it('prompts then force-removes an Orca-created unregistered leftover directory with no git marker', async () => {
    const parentDir = await mkdtemp(join(tmpdir(), 'orca-ipc-leftover-'))
    const repoPath = join(parentDir, 'repo')
    const leftoverPath = join(parentDir, 'leftover')
    const worktreeId = `repo-1::${leftoverPath}`
    await mkdir(leftoverPath, { recursive: true })
    await writeFile(join(leftoverPath, 'leftover.txt'), 'kept until force\n')
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: repoPath,
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      worktreeBaseRef: null
    })
    mockKnownFeatureWorktree(join(parentDir, 'real-feature'), repoPath)
    store.getWorktreeMeta.mockReturnValue(
      makeWorktreeMeta({ orcaCreatedAt: Date.now(), orcaCreationSource: 'runtime' })
    )
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status') {
        throw new Error('fatal: not a git repository')
      }
      return { stdout: '', stderr: '' }
    })

    try {
      await expect(handlers['worktrees:remove'](null, { worktreeId })).rejects.toThrow(
        'Worktree is no longer registered with Git but its directory remains.'
      )
      await expect(lstat(leftoverPath)).resolves.toBeTruthy()
      expect(removeWorktreeMock).not.toHaveBeenCalled()
      expect(store.removeWorktreeMeta).not.toHaveBeenCalled()

      await expect(
        handlers['worktrees:remove'](null, { worktreeId, force: true })
      ).resolves.toEqual({})

      await expect(lstat(leftoverPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(killAllProcessesForWorktreeMock).toHaveBeenCalledWith(
        worktreeId,
        expect.objectContaining({ requirePhysicalStop: true })
      )
      expect(runHookMock).not.toHaveBeenCalled()
      expect(removeWorktreeMock).not.toHaveBeenCalled()
      expect(runtimeStub.clearOptimisticReconcileToken).toHaveBeenCalledWith(worktreeId)
      expect(store.removeWorktreeMeta).toHaveBeenCalledWith(worktreeId, 'local')
      expect(deleteWorktreeHistoryDirMock).toHaveBeenCalledWith(worktreeId)
      expect(mainWindow.webContents.send).toHaveBeenCalledWith('worktrees:changed', {
        repoId: 'repo-1'
      })
    } finally {
      await rm(parentDir, { recursive: true, force: true })
    }
  })

  it('rejects an Orca-created unregistered local directory with a git directory', async () => {
    const parentDir = await mkdtemp(join(tmpdir(), 'orca-ipc-standalone-'))
    const repoPath = join(parentDir, 'repo')
    const standalonePath = join(parentDir, 'standalone')
    await mkdir(join(standalonePath, '.git'), { recursive: true })
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: repoPath,
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      worktreeBaseRef: null
    })
    mockKnownFeatureWorktree(join(parentDir, 'real-feature'), repoPath)
    store.getWorktreeMeta.mockReturnValue(
      makeWorktreeMeta({ orcaCreatedAt: Date.now(), orcaCreationSource: 'runtime' })
    )

    try {
      await expect(
        handlers['worktrees:remove'](null, {
          worktreeId: `repo-1::${standalonePath}`,
          force: true
        })
      ).rejects.toThrow(`Refusing to delete unregistered worktree path: ${standalonePath}`)

      await expect(lstat(standalonePath)).resolves.toBeTruthy()
      expect(removeWorktreeMock).not.toHaveBeenCalled()
      expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
    } finally {
      await rm(parentDir, { recursive: true, force: true })
    }
  })

  it('coalesces concurrent deletes for the same worktree id', async () => {
    mockKnownFeatureWorktree()
    deleteWorktreeHistoryDirMock.mockClear()
    let removalStarted!: () => void
    let finishRemoval!: () => void
    const started = new Promise<void>((resolve) => {
      removalStarted = resolve
    })
    removeWorktreeMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          removalStarted()
          finishRemoval = resolve
        })
    )

    const first = handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt',
      force: true
    }) as Promise<unknown>
    const second = handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt',
      hostId: 'local',
      force: true
    }) as Promise<unknown>

    await started
    await Promise.resolve()
    expect(removeWorktreeMock).toHaveBeenCalledTimes(1)

    finishRemoval()
    await expect(Promise.all([first, second])).resolves.toEqual([{}, {}])
    expect(store.removeWorktreeMeta).toHaveBeenCalledTimes(1)
    expect(deleteWorktreeHistoryDirMock).toHaveBeenCalledTimes(1)
    expect(mainWindow.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('rejects concurrent deletes for the same worktree id with different options', async () => {
    mockKnownFeatureWorktree()
    let removalStarted!: () => void
    let finishRemoval!: () => void
    const started = new Promise<void>((resolve) => {
      removalStarted = resolve
    })
    removeWorktreeMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          removalStarted()
          finishRemoval = resolve
        })
    )

    const first = handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    }) as Promise<unknown>

    await started
    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/feature-wt',
        hostId: 'local',
        force: true
      })
    ).rejects.toThrow('Worktree deletion already in progress')

    expect(removeWorktreeMock).toHaveBeenCalledTimes(1)
    finishRemoval()
    await expect(first).resolves.toEqual({})
  })

  it('still rejects forced unregistered delete paths that exist on disk', async () => {
    mockKnownFeatureWorktree('/workspace/real-feature')

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: `repo-1::${process.cwd()}`,
        force: true
      })
    ).rejects.toThrow('Refusing to delete unregistered worktree path')

    expect(killAllProcessesForWorktreeMock).not.toHaveBeenCalled()
    expect(runHookMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
    expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
  })

  it('rejects the main worktree before teardown, hooks, or git removal', async () => {
    mockKnownFeatureWorktree()

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/repo'
      })
    ).rejects.toThrow('Refusing to delete protected worktree path')

    expect(killAllProcessesForWorktreeMock).not.toHaveBeenCalled()
    expect(runHookMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
    expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
  })

  it('rejects deleting a worktree that contains another registered worktree before teardown, hooks, or git removal', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/repo',
        head: 'main',
        branch: 'main',
        isBare: false,
        isMainWorktree: true
      },
      {
        path: '/workspace/parent',
        head: 'parent',
        branch: 'parent',
        isBare: false,
        isMainWorktree: false
      },
      {
        path: '/workspace/parent/child',
        head: 'child',
        branch: 'child',
        isBare: false,
        isMainWorktree: false
      }
    ])
    getEffectiveHooksMock.mockReturnValue({
      scripts: {
        archive: 'echo archived'
      }
    })

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/parent',
        force: true
      })
    ).rejects.toThrow(
      'Refusing to delete worktree because it contains another registered worktree: /workspace/parent/child'
    )

    expect(killAllProcessesForWorktreeMock).not.toHaveBeenCalled()
    expect(runHookMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
    expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
  })

  it('IPC-initiated delete kills PTYs BEFORE git-level removal (design §4.3)', async () => {
    mockKnownFeatureWorktree()
    getEffectiveHooksMock.mockReturnValue(null)
    const callOrder: string[] = []
    assertWorktreeCleanForRemovalMock.mockImplementation(async () => {
      callOrder.push('preflight')
    })
    killAllProcessesForWorktreeMock.mockImplementation(async () => {
      callOrder.push('kill')
      return { runtimeStopped: 1, providerStopped: 0, registryStopped: 0 }
    })
    removeWorktreeMock.mockImplementation(async () => {
      callOrder.push('git')
    })

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    })

    expect(killAllProcessesForWorktreeMock).toHaveBeenCalledWith(
      'repo-1::/workspace/feature-wt',
      expect.objectContaining({
        localProvider: expect.anything(),
        onPtyStopped: clearProviderPtyStateMock,
        requirePhysicalStop: true
      })
    )
    expect(removeWorktreeMock).toHaveBeenCalled()
    expect(callOrder).toEqual(['preflight', 'kill', 'git'])
  })

  // Regression: `repoId::path` ids repeat across hosts, so an SSH delete used to reach the
  // runtime's same-id local (or other-connection) terminals and stop them.
  // The local counterpart still identifies itself by exact id so a selector that resolves
  // two hosts can no longer decide which workspace loses its terminals.
  // Why (#11960): the PTY gate previously had no escape hatch at all, so a
  // workspace with an unprovable PTY was unremovable forever.
  it('forwards an explicit Force Delete to the PTY gate', async () => {
    mockKnownFeatureWorktree()
    getEffectiveHooksMock.mockReturnValue(null)

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt',
      force: true,
      allowUnverifiedPtyStop: true
    })

    expect(killAllProcessesForWorktreeMock).toHaveBeenCalledWith(
      'repo-1::/workspace/feature-wt',
      expect.objectContaining({ requirePhysicalStop: true, allowUnverifiedStop: true })
    )
  })

  // Why (#11960): the ordinary Delete confirmation already sets force:true to skip
  // the dirty-file prompt. Waiving PTY-stop proof off that signal would silently
  // disable the gate on the primary delete path.
  it('keeps the PTY gate strict for a confirmed delete that only sets force', async () => {
    mockKnownFeatureWorktree()
    getEffectiveHooksMock.mockReturnValue(null)

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt',
      force: true
    })

    expect(killAllProcessesForWorktreeMock).toHaveBeenCalledWith(
      'repo-1::/workspace/feature-wt',
      expect.not.objectContaining({ allowUnverifiedStop: true })
    )
  })

  it('keeps the PTY gate strict for a plain delete', async () => {
    mockKnownFeatureWorktree()
    getEffectiveHooksMock.mockReturnValue(null)

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    })

    expect(killAllProcessesForWorktreeMock).toHaveBeenCalledWith(
      'repo-1::/workspace/feature-wt',
      expect.not.objectContaining({ allowUnverifiedStop: true })
    )
  })

  it('does not start Git removal when physical PTY teardown cannot be proven', async () => {
    mockKnownFeatureWorktree()
    getEffectiveHooksMock.mockReturnValue(null)
    killAllProcessesForWorktreeMock.mockRejectedValueOnce(
      new Error('Timed out waiting for physical PTY teardown')
    )

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/feature-wt'
      })
    ).rejects.toThrow('Timed out waiting for physical PTY teardown')

    expect(removeWorktreeMock).not.toHaveBeenCalled()
    expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
  })

  it('routes local worktree removal through the selected WSL project runtime', async () => {
    mockSelectedWslProjectRuntime()
    mockKnownFeatureWorktree()
    getEffectiveHooksMock.mockReturnValue(null)
    removeWorktreeMock.mockResolvedValue({})

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    })

    expect(listWorktreesMock).toHaveBeenCalledWith('/workspace/repo', { wslDistro: 'Ubuntu' })
    expect(assertWorktreeCleanForRemovalMock).toHaveBeenCalledWith('/workspace/feature-wt', false, {
      wslDistro: 'Ubuntu'
    })
    expect(removeWorktreeMock).toHaveBeenCalledWith(
      '/workspace/repo',
      '/workspace/feature-wt',
      false,
      expect.objectContaining({ wslDistro: 'Ubuntu' })
    )
  })

  it('surfaces selected-runtime list failures during local worktree removal', async () => {
    mockSelectedWslProjectRuntime()
    const listError = new Error('wsl git list failed')
    listWorktreesMock.mockRejectedValue(listError)

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/feature-wt'
      })
    ).rejects.toThrow('wsl git list failed')

    expect(listWorktreesMock).toHaveBeenCalledWith('/workspace/repo', { wslDistro: 'Ubuntu' })
    expect(assertWorktreeCleanForRemovalMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
  })

  it('fails dirty non-force deletes before PTY teardown', async () => {
    mockKnownFeatureWorktree()
    const repoWithConfiguredRegularFile = {
      id: 'repo-1',
      path: '/workspace/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      symlinkPaths: ['scratch.txt']
    }
    store.getRepo.mockReturnValue(repoWithConfiguredRegularFile)
    store.getRepos.mockReturnValue([repoWithConfiguredRegularFile])
    getEffectiveHooksMock.mockReturnValue(null)
    assertWorktreeCleanForRemovalMock.mockRejectedValue(
      Object.assign(new Error('Worktree has uncommitted or untracked changes.'), {
        stdout: '?? scratch.txt\n'
      })
    )

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/feature-wt'
      })
    ).rejects.toThrow('Failed to delete worktree at /workspace/feature-wt. ?? scratch.txt')

    expect(findExistingWorktreeSymlinkPathsMock).toHaveBeenCalledWith('/workspace/feature-wt', [
      'scratch.txt'
    ])
    expect(assertWorktreeCleanForRemovalMock).toHaveBeenCalledWith('/workspace/feature-wt', false)
    expect(runtimeStub.closeFileWatchersForRemoval).not.toHaveBeenCalled()
    expect(removeWorktreeLinkedPathsMock).not.toHaveBeenCalled()
    expect(killAllProcessesForWorktreeMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
  })

  it('propagates a timed-out removal preflight before watcher teardown', async () => {
    mockKnownFeatureWorktree()
    getEffectiveHooksMock.mockReturnValue(null)
    assertWorktreeCleanForRemovalMock.mockRejectedValue(new Error('git timed out.'))

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/feature-wt'
      })
    ).rejects.toThrow('Failed to delete worktree at /workspace/feature-wt. git timed out.')

    expect(runtimeStub.closeFileWatchersForRemoval).not.toHaveBeenCalled()
    expect(killAllProcessesForWorktreeMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
  })

  it('fails locked dirty-force deletes before hooks, link cleanup, or PTY teardown', async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: '/workspace/repo',
        head: 'main',
        branch: 'main',
        isBare: false,
        isMainWorktree: true
      },
      {
        path: '/workspace/feature-wt',
        head: 'feature',
        branch: 'feature',
        isBare: false,
        isMainWorktree: false,
        locked: true,
        lockReason: 'active agent session'
      }
    ])
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: '/workspace/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      symlinkPaths: ['node_modules']
    })
    getEffectiveHooksMock.mockReturnValue({ scripts: { archive: 'echo archived' } })

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/feature-wt',
        force: true
      })
    ).rejects.toThrow(
      'Failed to force delete worktree at /workspace/feature-wt. Worktree is locked by Git.'
    )

    expect(assertWorktreeCleanForRemovalMock).not.toHaveBeenCalled()
    expect(runHookMock).not.toHaveBeenCalled()
    expect(removeWorktreeLinkedPathsMock).not.toHaveBeenCalled()
    expect(killAllProcessesForWorktreeMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
  })

  it('rechecks a local Git lock after the archive hook before teardown', async () => {
    const unlockedWorktrees = mockKnownFeatureWorktree()
    const lockedWorktrees = unlockedWorktrees.map((worktree) =>
      worktree.path === '/workspace/feature-wt'
        ? { ...worktree, locked: true, lockReason: 'locked during archive' }
        : worktree
    )
    listWorktreesMock
      .mockResolvedValueOnce(unlockedWorktrees)
      .mockResolvedValueOnce(lockedWorktrees)
    store.getRepo.mockReturnValue({
      id: 'repo-1',
      path: '/workspace/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0,
      symlinkPaths: ['node_modules']
    })
    getEffectiveHooksMock.mockReturnValue({ scripts: { archive: 'echo archived' } })
    runHookMock.mockResolvedValue({ success: true, output: '' })

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/feature-wt',
        force: true
      })
    ).rejects.toThrow('Worktree is locked by Git')

    expect(runHookMock).toHaveBeenCalled()
    expect(removeWorktreeLinkedPathsMock).not.toHaveBeenCalled()
    expect(assertWorktreeCleanForRemovalMock).not.toHaveBeenCalled()
    expect(killAllProcessesForWorktreeMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
  })

  it('formats preflight subprocess failures and does not tear down PTYs', async () => {
    mockKnownFeatureWorktree()
    getEffectiveHooksMock.mockReturnValue(null)
    assertWorktreeCleanForRemovalMock.mockRejectedValue(
      Object.assign(new Error('status failed'), {
        stderr: 'fatal: unable to read current working directory\n'
      })
    )

    await expect(
      handlers['worktrees:remove'](null, {
        worktreeId: 'repo-1::/workspace/feature-wt'
      })
    ).rejects.toThrow(
      'Failed to delete worktree at /workspace/feature-wt. fatal: unable to read current working directory'
    )

    expect(killAllProcessesForWorktreeMock).not.toHaveBeenCalled()
    expect(removeWorktreeMock).not.toHaveBeenCalled()
  })

  it('falls through to orphan cleanup when preflight reports missing/non-repo worktree', async () => {
    mockKnownFeatureWorktree()
    getEffectiveHooksMock.mockReturnValue(null)
    assertWorktreeCleanForRemovalMock.mockRejectedValue(
      Object.assign(new Error('status failed'), {
        stderr: 'fatal: not a git repository (or any of the parent directories): .git\n'
      })
    )
    removeWorktreeMock.mockRejectedValue(
      Object.assign(new Error('git worktree remove failed'), {
        stderr: "fatal: '/workspace/feature-wt' is not a working tree"
      })
    )
    gitExecFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })

    await handlers['worktrees:remove'](null, {
      worktreeId: 'repo-1::/workspace/feature-wt'
    })

    expect(killAllProcessesForWorktreeMock).toHaveBeenCalledWith(
      'repo-1::/workspace/feature-wt',
      expect.objectContaining({ requirePhysicalStop: true })
    )
    expect(removeWorktreeMock).toHaveBeenCalled()
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(['worktree', 'prune'], {
      cwd: '/workspace/repo'
    })
  })

  it('rejects ask-policy creates before mutating git state when setup decision is missing', async () => {
    getEffectiveHooksMock.mockReturnValue({
      scripts: {
        setup: 'pnpm worktree:setup'
      }
    })
    shouldRunSetupForCreateMock.mockImplementation(() => {
      throw new Error('Setup decision required for this repository')
    })

    await expect(
      handlers['worktrees:create'](null, {
        repoId: 'repo-1',
        name: 'improve-dashboard'
      })
    ).rejects.toThrow('Setup decision required for this repository')

    expect(addWorktreeMock).not.toHaveBeenCalled()
    expect(store.setWorktreeMeta).not.toHaveBeenCalled()
    expect(createSetupRunnerScriptMock).not.toHaveBeenCalled()
  })

  describe('worktrees:forgetLocal', () => {
    it('rejects forgetting a folder project root', async () => {
      const repo = {
        id: 'repo-folder',
        path: '/workspace/folder',
        displayName: 'folder',
        badgeColor: '#000',
        addedAt: 0,
        kind: 'folder' as const
      }
      store.getRepo.mockReturnValue(repo)

      await expect(
        handlers['worktrees:forgetLocal'](null, {
          worktreeId: `${repo.id}::${repo.path}`
        })
      ).rejects.toThrow(/project root workspace/)

      expect(store.removeWorktreeMeta).not.toHaveBeenCalled()
      expect(deleteWorktreeHistoryDirMock).not.toHaveBeenCalled()
    })
  })
})
