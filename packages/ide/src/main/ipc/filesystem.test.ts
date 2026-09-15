/* eslint-disable max-lines -- Why: filesystem authorization and git/file IPC invariants are exercised end-to-end here, so the scenarios stay together to keep the security boundary readable. */
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (_event: unknown, args: unknown) => Promise<unknown> | unknown>()
const {
  handleMock,
  showSaveDialogMock,
  showOpenDialogMock,
  fromWebContentsMock,
  trashItemMock,
  readdirMock,
  readFileMock,
  writeFileMock,
  statMock,
  openMock,
  renameMock,
  rmMock,
  realpathMock,
  lstatMock,
  commitChangesMock,
  getStatusMock,
  abortMergeMock,
  abortRebaseMock,
  getDiffMock,
  getBranchCompareMock,
  getBranchDiffMock,
  getStagedCommitContextMock,
  stageFileMock,
  bulkStageFilesMock,
  unstageFileMock,
  bulkUnstageFilesMock,
  bulkDiscardChangesMock,
  discardChangesMock,
  checkIgnoredPathsMock,
  listWorktreesMock,
  resolveCommitMessageSettingsMock,
  generateCommitMessageFromContextMock,
  generatePullRequestFieldsFromContextMock,
  discoverCommitMessageModelsLocalMock,
  discoverCommitMessageModelsRemoteMock,
  cancelGenerateCommitMessageLocalMock,
  cancelGeneratePullRequestFieldsLocalMock,
  getPullRequestDraftContextMock,
  resolveHostedReviewBodyForGenerationMock,
  loadPullRequestLinkedIssueMock,
  getSshFilesystemProviderMock,
  getSshGitProviderMock,
  recordCrashBreadcrumbMock,
  promoteLocalDownloadedFolderMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  showSaveDialogMock: vi.fn(),
  showOpenDialogMock: vi.fn(),
  fromWebContentsMock: vi.fn(),
  trashItemMock: vi.fn(),
  readdirMock: vi.fn(),
  readFileMock: vi.fn(),
  writeFileMock: vi.fn(),
  statMock: vi.fn(),
  openMock: vi.fn(),
  renameMock: vi.fn(),
  rmMock: vi.fn(),
  realpathMock: vi.fn(),
  lstatMock: vi.fn(),
  commitChangesMock: vi.fn(),
  getStatusMock: vi.fn(),
  abortMergeMock: vi.fn(),
  abortRebaseMock: vi.fn(),
  getDiffMock: vi.fn(),
  getBranchCompareMock: vi.fn(),
  getBranchDiffMock: vi.fn(),
  getStagedCommitContextMock: vi.fn(),
  stageFileMock: vi.fn(),
  bulkStageFilesMock: vi.fn(),
  unstageFileMock: vi.fn(),
  bulkUnstageFilesMock: vi.fn(),
  bulkDiscardChangesMock: vi.fn(),
  discardChangesMock: vi.fn(),
  checkIgnoredPathsMock: vi.fn(),
  listWorktreesMock: vi.fn(),
  resolveCommitMessageSettingsMock: vi.fn(),
  generateCommitMessageFromContextMock: vi.fn(),
  generatePullRequestFieldsFromContextMock: vi.fn(),
  discoverCommitMessageModelsLocalMock: vi.fn(),
  discoverCommitMessageModelsRemoteMock: vi.fn(),
  cancelGenerateCommitMessageLocalMock: vi.fn(),
  cancelGeneratePullRequestFieldsLocalMock: vi.fn(),
  getPullRequestDraftContextMock: vi.fn(),
  resolveHostedReviewBodyForGenerationMock: vi.fn(),
  loadPullRequestLinkedIssueMock: vi.fn(),
  getSshFilesystemProviderMock: vi.fn(),
  getSshGitProviderMock: vi.fn(),
  recordCrashBreadcrumbMock: vi.fn(),
  promoteLocalDownloadedFolderMock: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: fromWebContentsMock
  },
  dialog: {
    showSaveDialog: showSaveDialogMock,
    showOpenDialog: showOpenDialogMock
  },
  ipcMain: {
    handle: handleMock
  },
  shell: {
    trashItem: trashItemMock
  }
}))

vi.mock('fs/promises', () => ({
  readdir: readdirMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
  stat: statMock,
  open: openMock,
  rename: renameMock,
  rm: rmMock,
  realpath: realpathMock,
  lstat: lstatMock
}))

vi.mock('../crash-reporting/crash-breadcrumb-store', () => ({
  recordCrashBreadcrumb: recordCrashBreadcrumbMock
}))

vi.mock('../local-downloaded-folder-promotion', () => ({
  promoteLocalDownloadedFolder: promoteLocalDownloadedFolderMock
}))

vi.mock('../git/status', () => ({
  commitChanges: commitChangesMock,
  getStatus: getStatusMock,
  abortMerge: abortMergeMock,
  abortRebase: abortRebaseMock,
  getDiff: getDiffMock,
  getBranchCompare: getBranchCompareMock,
  getBranchDiff: getBranchDiffMock,
  getStagedCommitContext: getStagedCommitContextMock,
  stageFile: stageFileMock,
  bulkStageFiles: bulkStageFilesMock,
  unstageFile: unstageFileMock,
  bulkUnstageFiles: bulkUnstageFilesMock,
  bulkDiscardChanges: bulkDiscardChangesMock,
  discardChanges: discardChangesMock
}))

vi.mock('../git/check-ignored-paths', () => ({
  checkIgnoredPaths: checkIgnoredPathsMock
}))

vi.mock('../git/worktree', () => ({
  listWorktrees: listWorktreesMock,
  listWorktreesStrict: listWorktreesMock
}))

vi.mock('../text-generation/commit-message-text-generation', () => ({
  resolveCommitMessageSettings: resolveCommitMessageSettingsMock,
  generateCommitMessageFromContext: generateCommitMessageFromContextMock,
  generatePullRequestFieldsFromContext: generatePullRequestFieldsFromContextMock,
  discoverCommitMessageModelsLocal: discoverCommitMessageModelsLocalMock,
  discoverCommitMessageModelsRemote: discoverCommitMessageModelsRemoteMock,
  cancelGenerateCommitMessageLocal: cancelGenerateCommitMessageLocalMock,
  cancelGeneratePullRequestFieldsLocal: cancelGeneratePullRequestFieldsLocalMock
}))

vi.mock('../text-generation/pull-request-context', () => ({
  getPullRequestDraftContext: getPullRequestDraftContextMock
}))

vi.mock('../source-control/pull-request-template', () => ({
  readHostedPullRequestTemplate: vi.fn(),
  readHostedReviewTemplate: vi.fn(),
  resolveHostedReviewBodyForGeneration: resolveHostedReviewBodyForGenerationMock
}))

vi.mock('../source-control/pull-request-linked-issue', () => ({
  loadPullRequestLinkedIssue: loadPullRequestLinkedIssueMock
}))

import { registerFilesystemHandlers } from './filesystem'
import { invalidateAuthorizedRootsCache, registerWorktreeRootsForRepo } from './filesystem-auth'

// Why: paths are resolved via path.resolve() in production code, so test
// data must use resolved paths to avoid Unix-vs-Windows mismatches.
const REPO_PATH = path.resolve('/workspace/repo')
const WORKSPACE_DIR = path.resolve('/workspace')
const WORKTREE_FEATURE_PATH = path.resolve('/workspace/repo-feature')

type MockDirEntry = {
  name: string
  directory?: boolean
  file?: boolean
  symlink?: boolean
}

function dirEntry({ name, directory, file, symlink }: MockDirEntry): {
  name: string
  isDirectory: () => boolean
  isFile: () => boolean
  isSymbolicLink: () => boolean
} {
  return {
    name,
    isDirectory: () => directory ?? false,
    isFile: () => file ?? false,
    isSymbolicLink: () => symlink ?? false
  }
}

async function withPlatform<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  try {
    return await run()
  } finally {
    if (original) {
      Object.defineProperty(process, 'platform', original)
    }
  }
}

describe('registerFilesystemHandlers', () => {
  const folderDownloadSender = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false)
  })
  const store = {
    getRepos: () => [
      {
        id: 'repo-1',
        path: REPO_PATH,
        displayName: 'repo',
        badgeColor: '#000',
        addedAt: 0
      }
    ],
    getSettings: () => ({
      workspaceDir: WORKSPACE_DIR
    })
  }

  beforeEach(() => {
    folderDownloadSender.removeAllListeners()
    folderDownloadSender.isDestroyed.mockReset().mockReturnValue(false)
    handlers.clear()
    for (const mock of [
      handleMock,
      showSaveDialogMock,
      showOpenDialogMock,
      fromWebContentsMock,
      trashItemMock,
      readdirMock,
      readFileMock,
      writeFileMock,
      statMock,
      openMock,
      renameMock,
      rmMock,
      realpathMock,
      lstatMock,
      recordCrashBreadcrumbMock,
      commitChangesMock,
      getStatusMock,
      abortMergeMock,
      abortRebaseMock,
      getDiffMock,
      getBranchCompareMock,
      getBranchDiffMock,
      getStagedCommitContextMock,
      stageFileMock,
      bulkStageFilesMock,
      unstageFileMock,
      bulkUnstageFilesMock,
      bulkDiscardChangesMock,
      discardChangesMock,
      listWorktreesMock,
      resolveCommitMessageSettingsMock,
      generateCommitMessageFromContextMock,
      generatePullRequestFieldsFromContextMock,
      getPullRequestDraftContextMock,
      resolveHostedReviewBodyForGenerationMock,
      loadPullRequestLinkedIssueMock,
      discoverCommitMessageModelsLocalMock,
      discoverCommitMessageModelsRemoteMock,
      cancelGenerateCommitMessageLocalMock,
      cancelGeneratePullRequestFieldsLocalMock,
      getSshFilesystemProviderMock,
      getSshGitProviderMock,
      promoteLocalDownloadedFolderMock
    ]) {
      mock.mockReset()
    }
    loadPullRequestLinkedIssueMock.mockResolvedValue(null)

    handleMock.mockImplementation((channel, handler) => {
      handlers.set(channel, handler)
    })

    // Reset module-level auth cache so each test starts with a fresh dirty
    // flag — prevents stale worktree data from a prior test's cache rebuild.
    invalidateAuthorizedRootsCache()

    realpathMock.mockImplementation(async (targetPath: string) => targetPath)
    listWorktreesMock.mockResolvedValue([
      {
        path: WORKTREE_FEATURE_PATH,
        head: 'abc',
        branch: '',
        isBare: false,
        isMainWorktree: false
      }
    ])
    trashItemMock.mockResolvedValue(undefined)
    promoteLocalDownloadedFolderMock.mockResolvedValue(undefined)
    showSaveDialogMock.mockResolvedValue({ canceled: true })
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] })
    fromWebContentsMock.mockReturnValue(null)
    getSshGitProviderMock.mockReturnValue(null)
    statMock.mockResolvedValue({ size: 10, isDirectory: () => false, mtimeMs: 123 })
    renameMock.mockResolvedValue(undefined)
    rmMock.mockResolvedValue(undefined)
    openMock.mockResolvedValue({
      read: vi.fn(async (buffer: Buffer) => {
        buffer.fill(0x61)
        return { bytesRead: buffer.length, buffer }
      }),
      write: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      close: vi.fn()
    })
    lstatMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  })

  // Why: handler-level WSL UNC authorization depends on native Windows path
  // resolution; path-shape classification has separate cross-platform coverage.
  it.runIf(process.platform === 'win32')(
    'records a redacted breadcrumb when fs:readDir throws on a WSL UNC path',
    async () => {
      registerFilesystemHandlers(store as never)
      const wslPath = path.win32.join('\\\\wsl.localhost\\Ubuntu', 'home', 'user', 'repo')
      // resolveAuthorizedPath authorizes the path, then readdir fails (distro stopped).
      realpathMock.mockResolvedValue(wslPath)
      registerWorktreeRootsForRepo(store as never, 'repo-1', [wslPath])
      readdirMock.mockRejectedValue(Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }))

      await expect(handlers.get('fs:readDir')!(null, { dirPath: wslPath })).rejects.toThrow(/EIO/)

      expect(recordCrashBreadcrumbMock).toHaveBeenCalledWith('fs_readdir_error', {
        throwSite: 'readdir',
        errorName: 'Error',
        errorCode: 'EIO',
        hasConnectionId: false,
        isUNC: true,
        isWsl: true
      })
      // The raw path must never appear in the breadcrumb payload.
      const [, breadcrumbData] = recordCrashBreadcrumbMock.mock.calls[0]
      expect(JSON.stringify(breadcrumbData)).not.toContain('user')
    }
  )

  it('records a breadcrumb tagged authorize when the path is denied', async () => {
    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('fs:readDir')!(null, { dirPath: path.resolve('/etc/passwd') })
    ).rejects.toThrow()

    expect(recordCrashBreadcrumbMock).toHaveBeenCalledWith(
      'fs_readdir_error',
      expect.objectContaining({ throwSite: 'authorize', hasConnectionId: false })
    )
  })

  it('does not record a breadcrumb when fs:readDir succeeds', async () => {
    registerFilesystemHandlers(store as never)
    readdirMock.mockResolvedValue([dirEntry({ name: 'file.ts', file: true })])

    await handlers.get('fs:readDir')!(null, { dirPath: REPO_PATH })

    expect(recordCrashBreadcrumbMock).not.toHaveBeenCalled()
  })

  it('streams runtime download chunks to a temp sibling then promotes on finish', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    openMock.mockResolvedValue({ writeFile, close })
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/downloads/report.pdf' })
    statMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    registerFilesystemHandlers(store as never)

    const started = await handlers.get('fs:startDownloadedFile')!(
      { sender: {} },
      { suggestedName: 'report.pdf' }
    )
    expect(started).toMatchObject({
      canceled: false,
      destinationPath: '/downloads/report.pdf'
    })
    if (!started || typeof started !== 'object' || !('transferId' in started)) {
      throw new Error('download did not start')
    }
    const transferId = started.transferId

    await expect(
      handlers.get('fs:appendDownloadedFileChunk')!(null, {
        transferId,
        contentBase64: Buffer.from('hello').toString('base64')
      })
    ).resolves.toEqual({ ok: true })
    await expect(handlers.get('fs:finishDownloadedFile')!(null, { transferId })).resolves.toEqual({
      canceled: false,
      destinationPath: '/downloads/report.pdf'
    })

    const tempPath = openMock.mock.calls[0][0]
    expect(path.dirname(tempPath)).toBe(path.normalize('/downloads'))
    expect(openMock).toHaveBeenCalledWith(tempPath, 'wx')
    expect(writeFile).toHaveBeenCalledWith(Buffer.from('hello'))
    expect(close).toHaveBeenCalled()
    expect(renameMock).toHaveBeenCalledWith(tempPath, '/downloads/report.pdf')
  })

  it('cleans up a runtime download temp file on cancel', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    openMock.mockResolvedValue({ writeFile: vi.fn(), close })
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/downloads/report.pdf' })
    statMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    registerFilesystemHandlers(store as never)

    const started = await handlers.get('fs:startDownloadedFile')!(
      { sender: {} },
      { suggestedName: 'report.pdf' }
    )
    if (!started || typeof started !== 'object' || !('transferId' in started)) {
      throw new Error('download did not start')
    }
    const tempPath = openMock.mock.calls[0][0]

    await expect(
      handlers.get('fs:cancelDownloadedFile')!(null, { transferId: started.transferId })
    ).resolves.toEqual({ ok: true })

    expect(close).toHaveBeenCalled()
    expect(rmMock).toHaveBeenCalledWith(tempPath, { force: true })
    expect(renameMock).not.toHaveBeenCalled()
  })

  it('rejects readFile when the real path escapes allowed roots', async () => {
    const linkPath = path.resolve('/workspace/repo/link.txt')
    realpathMock.mockImplementation(async (targetPath: string) => {
      if (targetPath === linkPath) {
        return path.resolve('/private/secret.txt')
      }
      return targetPath
    })

    registerFilesystemHandlers(store as never)

    await expect(handlers.get('fs:readFile')!(null, { filePath: linkPath })).rejects.toThrow(
      'Access denied: path resolves outside allowed directories'
    )

    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('allows readDir when a registered worktree resolves to a macOS canonical alias', async () => {
    const aliasWorktreePath = path.resolve('/var/folders/orca/worktrees/feature')
    const canonicalWorktreePath = path.resolve('/private/var/folders/orca/worktrees/feature')
    registerWorktreeRootsForRepo(store as never, 'repo-1', [REPO_PATH, aliasWorktreePath])
    realpathMock.mockImplementation(async (targetPath: string) => {
      if (targetPath === aliasWorktreePath) {
        return canonicalWorktreePath
      }
      return targetPath
    })
    readdirMock.mockResolvedValue([dirEntry({ name: 'README.md', file: true })])

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('fs:readDir')!(null, { dirPath: aliasWorktreePath })
    ).resolves.toEqual([{ name: 'README.md', isDirectory: false, isSymlink: false }])

    expect(readdirMock).toHaveBeenCalledWith(canonicalWorktreePath, { withFileTypes: true })
    expect(listWorktreesMock).not.toHaveBeenCalled()
  })

  it('does not follow symlinks when classifying readDir entries', async () => {
    const modelLinkPath = path.join(REPO_PATH, 'Model')
    readdirMock.mockResolvedValue([
      dirEntry({ name: 'README.md', file: true }),
      dirEntry({ name: 'Model', directory: true, symlink: true })
    ])
    statMock.mockImplementation(async (targetPath: string) => ({
      size: 10,
      isDirectory: () => targetPath === modelLinkPath,
      mtimeMs: 123
    }))

    registerFilesystemHandlers(store as never)

    await expect(handlers.get('fs:readDir')!(null, { dirPath: REPO_PATH })).resolves.toEqual([
      { name: 'Model', isDirectory: false, isSymlink: true },
      { name: 'README.md', isDirectory: false, isSymlink: false }
    ])
    expect(statMock).not.toHaveBeenCalledWith(modelLinkPath)
  })

  it('returns false from pathExists when a local authorized path is missing', async () => {
    const targetPath = path.join(REPO_PATH, 'untitled-7.md')
    statMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))

    registerFilesystemHandlers(store as never)

    await expect(handlers.get('fs:pathExists')!(null, { filePath: targetPath })).resolves.toBe(
      false
    )

    expect(statMock).toHaveBeenCalledWith(targetPath)
  })

  it('allows deletePath when a registered worktree parent resolves to a macOS canonical alias', async () => {
    const aliasWorktreePath = path.resolve('/var/folders/orca/worktrees/feature')
    const canonicalWorktreePath = path.resolve('/private/var/folders/orca/worktrees/feature')
    const aliasFilePath = path.join(aliasWorktreePath, 'README.md')
    const canonicalFilePath = path.join(canonicalWorktreePath, 'README.md')
    registerWorktreeRootsForRepo(store as never, 'repo-1', [REPO_PATH, aliasWorktreePath])
    realpathMock.mockImplementation(async (targetPath: string) => {
      if (targetPath === aliasWorktreePath) {
        return canonicalWorktreePath
      }
      return targetPath
    })

    registerFilesystemHandlers(store as never)

    await handlers.get('fs:deletePath')!(null, { targetPath: aliasFilePath })

    expect(trashItemMock).toHaveBeenCalledWith(canonicalFilePath)
    expect(listWorktreesMock).not.toHaveBeenCalled()
  })

  it('rejects readFile when a symlink in a canonical alias worktree escapes the registered root', async () => {
    const aliasWorktreePath = path.resolve('/var/folders/orca/worktrees/feature')
    const canonicalWorktreePath = path.resolve('/private/var/folders/orca/worktrees/feature')
    const aliasLinkPath = path.join(aliasWorktreePath, 'link.txt')
    registerWorktreeRootsForRepo(store as never, 'repo-1', [REPO_PATH, aliasWorktreePath])
    realpathMock.mockImplementation(async (targetPath: string) => {
      if (targetPath === aliasWorktreePath) {
        return canonicalWorktreePath
      }
      if (targetPath === aliasLinkPath) {
        return path.resolve('/private/secret.txt')
      }
      return targetPath
    })

    registerFilesystemHandlers(store as never)

    await expect(handlers.get('fs:readFile')!(null, { filePath: aliasLinkPath })).rejects.toThrow(
      'Access denied: path resolves outside allowed directories'
    )

    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('does not enumerate worktrees when filesystem handlers register', () => {
    registerFilesystemHandlers(store as never)

    expect(listWorktreesMock).not.toHaveBeenCalled()
  })

  it('rejects writes to directories', async () => {
    lstatMock.mockResolvedValue({ isDirectory: () => true })

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('fs:writeFile')!(null, {
        filePath: path.resolve('/workspace/repo/folder'),
        content: 'data'
      })
    ).rejects.toThrow('Cannot write to a directory')

    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it.each([
    ['fs:writeFile', { filePath: path.resolve('/workspace/repo/file.txt'), content: 'data' }],
    ['fs:deletePath', { targetPath: path.resolve('/workspace/repo/file.txt') }]
  ])(
    'rejects %s before local mutation when the expected execution host is SSH',
    async (channel, args) => {
      registerFilesystemHandlers(store as never)

      await expect(
        handlers.get(channel)!(null, { ...args, expectedExecutionHostId: 'ssh:ssh-1' })
      ).rejects.toThrow('Workspace host changed; refresh and try again')

      expect(writeFileMock).not.toHaveBeenCalled()
      expect(trashItemMock).not.toHaveBeenCalled()
    }
  )

  it.each([
    { ext: 'png', mime: 'image/png', data: [0x89, 0x50, 0x4e, 0x47, 0x00] },
    { ext: 'pdf', mime: 'application/pdf', data: [0x25, 0x50, 0x44, 0x46, 0x00] },
    {
      ext: 'svg',
      mime: 'image/svg+xml',
      data: Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'))
    }
  ])('returns base64 content for supported $ext binaries', async ({ ext, mime, data }) => {
    const buf = Buffer.from(data)
    statMock.mockResolvedValue({ size: buf.length, isDirectory: () => false, mtimeMs: 123 })
    readFileMock.mockResolvedValue(buf)
    registerFilesystemHandlers(store as never)
    await expect(
      handlers.get('fs:readFile')!(null, { filePath: path.resolve(`/workspace/repo/file.${ext}`) })
    ).resolves.toEqual({
      content: buf.toString('base64'),
      isBinary: true,
      isImage: true,
      mimeType: mime
    })
  })

  it('opens text files larger than the old 5MB guard', async () => {
    const content = 'a'.repeat(6 * 1024 * 1024)
    statMock.mockResolvedValue({ size: content.length, isDirectory: () => false, mtimeMs: 123 })
    readFileMock.mockResolvedValue(Buffer.from(content))

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('fs:readFile')!(null, { filePath: path.resolve('/workspace/repo/large.json') })
    ).resolves.toEqual({
      content,
      isBinary: false
    })
  })

  it('returns stable byte metadata only for opted-in local log snapshots', async () => {
    const content = Buffer.from('first\npartial')
    const close = vi.fn()
    openMock.mockResolvedValue({
      stat: vi.fn().mockResolvedValue({
        size: content.byteLength,
        dev: 1,
        ino: 2,
        birthtimeMs: 3
      }),
      readFile: vi.fn().mockResolvedValue(content),
      close
    })
    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('fs:readFile')!(null, {
        filePath: path.resolve('/workspace/repo/session.jsonl'),
        includeLocalLogMetadata: true
      })
    ).resolves.toEqual({
      content: 'first\npartial',
      isBinary: false,
      fileIdentity: '1:2:3'
    })
    expect(close).toHaveBeenCalledTimes(1)
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('rejects text files beyond the editor read budget', async () => {
    statMock.mockResolvedValue({ size: 51 * 1024 * 1024, isDirectory: () => false, mtimeMs: 123 })

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('fs:readFile')!(null, { filePath: path.resolve('/workspace/repo/huge.json') })
    ).rejects.toThrow('exceeds 50MB limit')

    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('probes large unknown binaries without reading the full file', async () => {
    statMock.mockResolvedValue({ size: 6 * 1024 * 1024, isDirectory: () => false, mtimeMs: 123 })
    openMock.mockResolvedValue({
      read: vi.fn(async (buffer: Buffer) => {
        buffer[0] = 0x00
        return { bytesRead: 1, buffer }
      }),
      close: vi.fn()
    })

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('fs:readFile')!(null, { filePath: path.resolve('/workspace/repo/archive.bin') })
    ).resolves.toEqual({
      content: '',
      isBinary: true
    })

    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('moves files to trash', async () => {
    registerFilesystemHandlers(store as never)
    const targetPath = path.resolve('/workspace/repo/file.txt')

    await handlers.get('fs:deletePath')!(null, { targetPath })

    expect(trashItemMock).toHaveBeenCalledWith(targetPath)
  })

  it('keeps non-image binaries hidden from the editor payload', async () => {
    statMock.mockResolvedValue({ size: 4, isDirectory: () => false, mtimeMs: 123 })
    readFileMock.mockResolvedValue(Buffer.from([0x00, 0x01, 0x02]))

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('fs:readFile')!(null, { filePath: path.resolve('/workspace/repo/archive.zip') })
    ).resolves.toEqual({
      content: '',
      isBinary: true
    })
  })

  it('normalizes repo worktree paths and keeps git file paths relative', async () => {
    stageFileMock.mockResolvedValue(undefined)

    registerFilesystemHandlers(store as never)

    await handlers.get('git:stage')!(null, {
      worktreePath: WORKTREE_FEATURE_PATH,
      filePath: './src/../src/file.ts'
    })

    // Why: validateGitRelativeFilePath uses path.relative() which produces
    // platform-specific separators (backslashes on Windows).
    expect(stageFileMock).toHaveBeenCalledWith(
      WORKTREE_FEATURE_PATH,
      path.join('src', 'file.ts'),
      {}
    )
  })

  it('uses worktree roots seeded by worktrees:list without rebuilding the cache', async () => {
    registerWorktreeRootsForRepo(store as never, 'repo-1', [REPO_PATH, WORKTREE_FEATURE_PATH])
    getStatusMock.mockResolvedValue({ entries: [] })

    registerFilesystemHandlers(store as never)

    await handlers.get('git:status')!(null, { worktreePath: WORKTREE_FEATURE_PATH })

    expect(listWorktreesMock).not.toHaveBeenCalled()
    expect(realpathMock).not.toHaveBeenCalledWith(WORKTREE_FEATURE_PATH)
    expect(getStatusMock).toHaveBeenCalledWith(WORKTREE_FEATURE_PATH, { includeIgnored: false })
  })

  it('passes configured shared links through the local status path', async () => {
    const sharedStore = {
      ...store,
      getRepos: () => [
        {
          ...store.getRepos()[0],
          symlinkPaths: ['node_modules']
        }
      ],
      getAllWorktreeMeta: () => ({
        [`repo-1::${WORKTREE_FEATURE_PATH}`]: {}
      })
    }
    registerWorktreeRootsForRepo(sharedStore as never, 'repo-1', [REPO_PATH, WORKTREE_FEATURE_PATH])
    getStatusMock.mockResolvedValue({ entries: [] })

    registerFilesystemHandlers(sharedStore as never)

    await handlers.get('git:status')!(null, { worktreePath: WORKTREE_FEATURE_PATH })

    expect(getStatusMock).toHaveBeenCalledWith(WORKTREE_FEATURE_PATH, {
      includeIgnored: false,
      sharedLinkPaths: ['node_modules']
    })
  })

  it('allows git operations on the known repo root without rebuilding the worktree cache', async () => {
    getStatusMock.mockResolvedValue({ entries: [] })

    registerFilesystemHandlers(store as never)

    await handlers.get('git:status')!(null, { worktreePath: REPO_PATH })

    expect(listWorktreesMock).not.toHaveBeenCalled()
    expect(realpathMock).not.toHaveBeenCalledWith(REPO_PATH)
    expect(getStatusMock).toHaveBeenCalledWith(REPO_PATH, { includeIgnored: false })
  })

  it('aborts tokenized local status without crossing renderer boundaries', async () => {
    registerWorktreeRootsForRepo(store as never, 'repo-1', [REPO_PATH, WORKTREE_FEATURE_PATH])
    const statusSignals: AbortSignal[] = []
    getStatusMock.mockImplementation(
      (_worktreePath: string, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (options.signal) {
            statusSignals.push(options.signal)
            options.signal.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true
            })
          }
        })
    )
    registerFilesystemHandlers(store as never)

    const firstEvent = { sender: { id: 7 } }
    const secondEvent = { sender: { id: 8 } }
    const firstRequest = handlers.get('git:status')!(firstEvent, {
      worktreePath: WORKTREE_FEATURE_PATH,
      requestToken: 'status-1'
    }) as Promise<unknown>
    const secondRequest = handlers.get('git:status')!(secondEvent, {
      worktreePath: WORKTREE_FEATURE_PATH,
      requestToken: 'status-1'
    }) as Promise<unknown>
    await vi.waitFor(() => expect(statusSignals).toHaveLength(2))
    await handlers.get('git:cancelStatus')!(firstEvent, { requestToken: 'status-1' })

    expect(statusSignals[0]?.aborted).toBe(true)
    expect(statusSignals[1]?.aborted).toBe(false)
    await expect(firstRequest).rejects.toThrow('aborted')

    await handlers.get('git:cancelStatus')!(secondEvent, { requestToken: 'status-1' })
    await expect(secondRequest).rejects.toThrow('aborted')
  })

  it('rejects git file paths that escape the selected worktree', async () => {
    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('git:discard')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH,
        filePath: '../outside.txt'
      })
    ).rejects.toThrow('Access denied: git file path escapes the selected worktree')

    expect(discardChangesMock).not.toHaveBeenCalled()
  })

  it('rejects git operations for unknown worktrees', async () => {
    listWorktreesMock.mockResolvedValue([])

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('git:status')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH
      })
    ).rejects.toThrow('Access denied: unknown repository or worktree path')

    expect(getStatusMock).not.toHaveBeenCalled()
  })

  it('normalizes git file paths for bulk stage requests', async () => {
    bulkStageFilesMock.mockResolvedValue(undefined)

    registerFilesystemHandlers(store as never)

    await handlers.get('git:bulkStage')!(null, {
      worktreePath: WORKTREE_FEATURE_PATH,
      filePaths: ['./src/../src/file.ts', 'nested//child.ts']
    })

    expect(bulkStageFilesMock).toHaveBeenCalledWith(
      WORKTREE_FEATURE_PATH,
      [path.join('src', 'file.ts'), path.join('nested', 'child.ts')],
      {}
    )
  })

  it('normalizes git file paths for bulk discard requests', async () => {
    bulkDiscardChangesMock.mockResolvedValue(undefined)

    registerFilesystemHandlers(store as never)

    await handlers.get('git:bulkDiscard')!(null, {
      worktreePath: WORKTREE_FEATURE_PATH,
      filePaths: ['./src/../src/file.ts', 'nested//child.ts']
    })

    expect(bulkDiscardChangesMock).toHaveBeenCalledWith(
      WORKTREE_FEATURE_PATH,
      [path.join('src', 'file.ts'), path.join('nested', 'child.ts')],
      {}
    )
  })

  it('rejects bulk unstage requests that escape the selected worktree', async () => {
    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('git:bulkUnstage')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH,
        filePaths: ['src/file.ts', '../outside.txt']
      })
    ).rejects.toThrow('Access denied: git file path escapes the selected worktree')

    expect(bulkUnstageFilesMock).not.toHaveBeenCalled()
  })

  it('rejects bulk discard requests that escape the selected worktree', async () => {
    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('git:bulkDiscard')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH,
        filePaths: ['src/file.ts', '../outside.txt']
      })
    ).rejects.toThrow('Access denied: git file path escapes the selected worktree')

    expect(bulkDiscardChangesMock).not.toHaveBeenCalled()
  })

  it('lists markdown documents recursively for a registered worktree', async () => {
    readdirMock.mockImplementation(async (dirPath: string) => {
      if (dirPath === WORKTREE_FEATURE_PATH) {
        return [
          dirEntry({ name: 'README.md', file: true }),
          dirEntry({ name: 'docs', directory: true }),
          dirEntry({ name: 'script.ts', file: true })
        ]
      }
      if (dirPath === path.join(WORKTREE_FEATURE_PATH, 'docs')) {
        return [
          dirEntry({ name: 'Guide.MDX', file: true }),
          dirEntry({ name: 'notes.markdown', file: true })
        ]
      }
      return []
    })

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('fs:listMarkdownDocuments')!(null, {
        rootPath: WORKTREE_FEATURE_PATH
      })
    ).resolves.toEqual([
      {
        filePath: path.join(WORKTREE_FEATURE_PATH, 'docs', 'Guide.MDX'),
        relativePath: 'docs/Guide.MDX',
        basename: 'Guide.MDX',
        name: 'Guide'
      },
      {
        filePath: path.join(WORKTREE_FEATURE_PATH, 'docs', 'notes.markdown'),
        relativePath: 'docs/notes.markdown',
        basename: 'notes.markdown',
        name: 'notes'
      },
      {
        filePath: path.join(WORKTREE_FEATURE_PATH, 'README.md'),
        relativePath: 'README.md',
        basename: 'README.md',
        name: 'README'
      }
    ])
  })

  it('skips ignored and symlinked directories when listing markdown documents', async () => {
    readdirMock.mockImplementation(async (dirPath: string) => {
      if (dirPath === WORKTREE_FEATURE_PATH) {
        return [
          dirEntry({ name: '.git', directory: true }),
          dirEntry({ name: '.hidden', directory: true }),
          dirEntry({ name: '.github', directory: true }),
          dirEntry({ name: 'node_modules', directory: true }),
          dirEntry({ name: 'linked-docs', directory: true, symlink: true }),
          dirEntry({ name: 'visible.md', file: true })
        ]
      }
      if (dirPath === path.join(WORKTREE_FEATURE_PATH, '.github')) {
        return [dirEntry({ name: 'CONTRIBUTING.md', file: true })]
      }
      throw new Error(`Unexpected readdir: ${dirPath}`)
    })

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('fs:listMarkdownDocuments')!(null, {
        rootPath: WORKTREE_FEATURE_PATH
      })
    ).resolves.toEqual([
      {
        filePath: path.join(WORKTREE_FEATURE_PATH, '.github', 'CONTRIBUTING.md'),
        relativePath: '.github/CONTRIBUTING.md',
        basename: 'CONTRIBUTING.md',
        name: 'CONTRIBUTING'
      },
      {
        filePath: path.join(WORKTREE_FEATURE_PATH, 'visible.md'),
        relativePath: 'visible.md',
        basename: 'visible.md',
        name: 'visible'
      }
    ])
  })

  it('rejects markdown document listing for authorized but unregistered roots', async () => {
    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('fs:listMarkdownDocuments')!(null, {
        rootPath: path.resolve('/workspace/unregistered')
      })
    ).rejects.toThrow('Access denied: unknown repository or worktree path')

    expect(readdirMock).not.toHaveBeenCalled()
  })

  it('routes branch compare queries through the git compare helper', async () => {
    getBranchCompareMock.mockResolvedValue({
      summary: {
        baseRef: 'origin/main',
        baseOid: 'base-oid',
        compareRef: 'main',
        headOid: 'head-oid',
        mergeBase: 'merge-base-oid',
        changedFiles: 1,
        status: 'ready'
      },
      entries: [{ path: 'src/file.ts', status: 'modified' }]
    })

    registerFilesystemHandlers(store as never)

    await handlers.get('git:branchCompare')!(null, {
      worktreePath: WORKTREE_FEATURE_PATH,
      baseRef: 'origin/main'
    })

    expect(getBranchCompareMock).toHaveBeenCalledWith(WORKTREE_FEATURE_PATH, 'origin/main', {})
  })

  it('routes local git:commit through commitChanges and returns success', async () => {
    commitChangesMock.mockResolvedValue({ success: true })

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('git:commit')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH,
        message: 'feat: ship commit'
      })
    ).resolves.toEqual({ success: true })

    expect(commitChangesMock).toHaveBeenCalledWith(WORKTREE_FEATURE_PATH, 'feat: ship commit', {})
  })

  it('returns local commit hook failure payload from git:commit', async () => {
    commitChangesMock.mockResolvedValue({ success: false, error: 'hook failed' })

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('git:commit')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH,
        message: 'feat: ship commit'
      })
    ).resolves.toEqual({ success: false, error: 'hook failed' })
  })

  it('generates a local commit message from main-process staged context', async () => {
    const context = {
      branch: 'feature/ai',
      stagedSummary: 'M\tREADME.md',
      stagedPatch: '+hello'
    }
    const params = { agentId: 'codex', model: 'gpt-5.4-mini', thinkingLevel: 'low' }
    resolveCommitMessageSettingsMock.mockReturnValue({ ok: true, params })
    getStagedCommitContextMock.mockResolvedValue(context)
    generateCommitMessageFromContextMock.mockResolvedValue({
      success: true,
      message: 'Update README'
    })

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('git:generateCommitMessage')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH
      })
    ).resolves.toEqual({ success: true, message: 'Update README' })

    expect(getStagedCommitContextMock).toHaveBeenCalledWith(WORKTREE_FEATURE_PATH, {})
    expect(generateCommitMessageFromContextMock).toHaveBeenCalledWith(context, params, {
      kind: 'local',
      cwd: WORKTREE_FEATURE_PATH
    })
  })

  it('uses one-shot resolved params for local commit message generation', async () => {
    const context = {
      branch: 'feature/ai',
      stagedSummary: 'M\tREADME.md',
      stagedPatch: '+hello'
    }
    const sourceControlAiResolvedParams = {
      agentId: 'codex' as const,
      model: 'gpt-5.5',
      thinkingLevel: 'high',
      customPrompt: 'Use Conventional Commits.'
    }
    getStagedCommitContextMock.mockResolvedValue(context)
    generateCommitMessageFromContextMock.mockResolvedValue({
      success: true,
      message: 'feat: update readme'
    })

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('git:generateCommitMessage')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH,
        sourceControlAiResolvedParams
      })
    ).resolves.toEqual({ success: true, message: 'feat: update readme' })

    expect(resolveCommitMessageSettingsMock).not.toHaveBeenCalled()
    expect(generateCommitMessageFromContextMock).toHaveBeenCalledWith(
      context,
      sourceControlAiResolvedParams,
      {
        kind: 'local',
        cwd: WORKTREE_FEATURE_PATH
      }
    )
  })

  it('prepares the selected Codex account home before local generation', async () => {
    const context = {
      branch: 'feature/ai',
      stagedSummary: 'M\tREADME.md',
      stagedPatch: '+hello'
    }
    const params = { agentId: 'codex', model: 'gpt-5.4-mini', thinkingLevel: 'low' }
    resolveCommitMessageSettingsMock.mockReturnValue({ ok: true, params })
    getStagedCommitContextMock.mockResolvedValue(context)
    generateCommitMessageFromContextMock.mockResolvedValue({
      success: true,
      message: 'Update README'
    })

    registerFilesystemHandlers(store as never, {
      prepareForCodexLaunch: () => '/managed/codex-home'
    })

    await handlers.get('git:generateCommitMessage')!(null, {
      worktreePath: WORKTREE_FEATURE_PATH
    })

    expect(generateCommitMessageFromContextMock).toHaveBeenCalledWith(
      context,
      params,
      expect.objectContaining({
        kind: 'local',
        cwd: WORKTREE_FEATURE_PATH,
        env: expect.objectContaining({ CODEX_HOME: '/managed/codex-home' })
      })
    )
  })

  it('prepares the Orca-managed Codex home for the default system selection', async () => {
    const context = {
      branch: 'feature/ai',
      stagedSummary: 'M\tREADME.md',
      stagedPatch: '+hello'
    }
    const params = { agentId: 'codex', model: 'gpt-5.4-mini', thinkingLevel: 'low' }
    resolveCommitMessageSettingsMock.mockReturnValue({ ok: true, params })
    getStagedCommitContextMock.mockResolvedValue(context)
    generateCommitMessageFromContextMock.mockResolvedValue({
      success: true,
      message: 'Update README'
    })

    registerFilesystemHandlers(store as never, {
      prepareForCodexLaunch: () => '/orca-managed/codex-home'
    })

    await handlers.get('git:generateCommitMessage')!(null, {
      worktreePath: WORKTREE_FEATURE_PATH
    })

    expect(generateCommitMessageFromContextMock).toHaveBeenCalledWith(
      context,
      params,
      expect.objectContaining({
        kind: 'local',
        cwd: WORKTREE_FEATURE_PATH,
        env: expect.objectContaining({ CODEX_HOME: '/orca-managed/codex-home' })
      })
    )
  })

  it('routes local WSL project commit-message generation through the project runtime target', async () => {
    await withPlatform('win32', async () => {
      const context = {
        branch: 'feature/ai',
        stagedSummary: 'M\tREADME.md',
        stagedPatch: '+hello'
      }
      const params = { agentId: 'codex', model: 'gpt-5.4-mini', thinkingLevel: 'low' }
      const prepareForCodexLaunch = vi.fn(() => '\\\\wsl.localhost\\Ubuntu\\home\\tester\\.codex')
      resolveCommitMessageSettingsMock.mockReturnValue({ ok: true, params })
      getStagedCommitContextMock.mockResolvedValue(context)
      generateCommitMessageFromContextMock.mockResolvedValue({
        success: true,
        message: 'Update README'
      })
      const wslStore = {
        ...store,
        getRepos: () => [
          {
            id: 'repo-1',
            path: WORKTREE_FEATURE_PATH,
            displayName: 'repo',
            badgeColor: '#000',
            addedAt: 0
          }
        ],
        getProjects: () => [
          {
            id: 'project-1',
            sourceRepoIds: ['repo-1'],
            localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' }
          }
        ],
        getSettings: () => ({
          workspaceDir: WORKSPACE_DIR,
          localWindowsRuntimeDefault: { kind: 'windows-host' }
        })
      }

      registerFilesystemHandlers(wslStore as never, { prepareForCodexLaunch })

      await handlers.get('git:generateCommitMessage')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH
      })

      expect(getStagedCommitContextMock).toHaveBeenCalledWith(WORKTREE_FEATURE_PATH, {
        wslDistro: 'Ubuntu'
      })
      expect(prepareForCodexLaunch).toHaveBeenCalledWith({
        runtime: 'wsl',
        wslDistro: 'Ubuntu'
      })
      expect(generateCommitMessageFromContextMock).toHaveBeenCalledWith(
        context,
        params,
        expect.objectContaining({
          kind: 'local',
          cwd: WORKTREE_FEATURE_PATH,
          wslDistro: 'Ubuntu',
          env: expect.objectContaining({ CODEX_HOME: '/home/tester/.codex' })
        })
      )
    })
  })

  it('enriches the local commit context with a validated worktree linked issue', async () => {
    const context = {
      branch: 'feature/ai',
      stagedSummary: 'M\tREADME.md',
      stagedPatch: '+hello'
    }
    const params = { agentId: 'codex', model: 'gpt-5.4-mini' }
    const worktreeId = `repo-1::${WORKTREE_FEATURE_PATH}`
    resolveCommitMessageSettingsMock.mockReturnValue({ ok: true, params })
    getStagedCommitContextMock.mockResolvedValue(context)
    generateCommitMessageFromContextMock.mockResolvedValue({ success: true, message: 'Update' })
    const linkedStore = {
      ...store,
      getWorktreeMeta: (id: string) => (id === worktreeId ? { linkedIssue: 123 } : undefined)
    }

    registerFilesystemHandlers(linkedStore as never)

    await handlers.get('git:generateCommitMessage')!(null, {
      worktreePath: WORKTREE_FEATURE_PATH,
      worktreeId
    })

    expect(generateCommitMessageFromContextMock).toHaveBeenCalledWith(
      { ...context, linkedIssue: 123 },
      params,
      expect.objectContaining({ kind: 'local' })
    )
  })

  // Why: folder-repo instances keep `::workspace:<uuid>` on the meta key while the
  // request path is the stripped cwd. A strip-before-lookup "cleanup" would still
  // pass plain-id tests and silently lose enrichment on second workspaces.
  it('enriches local commit context when the worktree id carries a folder-repo workspace suffix', async () => {
    const context = {
      branch: 'feature/ai',
      stagedSummary: 'M\tREADME.md',
      stagedPatch: '+hello'
    }
    const params = { agentId: 'codex', model: 'gpt-5.4-mini' }
    const instanceId = `repo-1::${WORKTREE_FEATURE_PATH}::workspace:${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`
    resolveCommitMessageSettingsMock.mockReturnValue({ ok: true, params })
    getStagedCommitContextMock.mockResolvedValue(context)
    generateCommitMessageFromContextMock.mockResolvedValue({ success: true, message: 'Update' })
    const getWorktreeMeta = vi.fn((id: string) =>
      id === instanceId ? { linkedIssue: 9 } : undefined
    )

    registerFilesystemHandlers({ ...store, getWorktreeMeta } as never)

    await handlers.get('git:generateCommitMessage')!(null, {
      worktreePath: WORKTREE_FEATURE_PATH,
      worktreeId: instanceId
    })

    expect(getWorktreeMeta).toHaveBeenCalledWith(instanceId)
    expect(generateCommitMessageFromContextMock).toHaveBeenCalledWith(
      { ...context, linkedIssue: 9 },
      params,
      expect.objectContaining({ kind: 'local' })
    )
  })

  // Why: the renderer derives worktreePath from worktreeId, so a mismatched pair
  // models an independent caller (relay/CLI/future), not a stale renderer context.
  it('ignores an independently supplied id that does not own the requested worktree path', async () => {
    const context = {
      branch: 'feature/ai',
      stagedSummary: 'M\tREADME.md',
      stagedPatch: '+hello'
    }
    const params = { agentId: 'codex', model: 'gpt-5.4-mini' }
    const getWorktreeMeta = vi.fn(() => ({ linkedIssue: 123 }))
    resolveCommitMessageSettingsMock.mockReturnValue({ ok: true, params })
    getStagedCommitContextMock.mockResolvedValue(context)
    generateCommitMessageFromContextMock.mockResolvedValue({ success: true, message: 'Update' })

    registerFilesystemHandlers({ ...store, getWorktreeMeta } as never)

    await handlers.get('git:generateCommitMessage')!(null, {
      worktreePath: WORKTREE_FEATURE_PATH,
      worktreeId: `repo-1::${path.resolve('/workspace/repo-other')}`
    })

    expect(getWorktreeMeta).not.toHaveBeenCalled()
    // Why: without this the assertion below passes vacuously on an early return.
    expect(generateCommitMessageFromContextMock.mock.calls).toHaveLength(1)
    expect(generateCommitMessageFromContextMock.mock.calls[0]?.[0]).not.toHaveProperty(
      'linkedIssue'
    )
  })

  describe('git:generatePullRequestFields linked issue', () => {
    const PULL_REQUEST_CONTEXT = {
      base: 'main',
      branch: 'feature/ai',
      branchChangedByPreparation: false,
      commitSummary: 'a1b2c3d Add generation',
      changeSummary: 'README.md | 2 +-',
      patch: '+hello',
      currentTitle: '',
      currentBody: '',
      currentDraft: false
    }
    const PULL_REQUEST_ARGS = { base: 'main', title: '', body: '', draft: false }
    const params = { agentId: 'codex', model: 'gpt-5.4-mini' }

    beforeEach(() => {
      resolveCommitMessageSettingsMock.mockReturnValue({ ok: true, params })
      resolveHostedReviewBodyForGenerationMock.mockResolvedValue('')
      getPullRequestDraftContextMock.mockResolvedValue(PULL_REQUEST_CONTEXT)
      generatePullRequestFieldsFromContextMock.mockResolvedValue({ success: true, fields: {} })
    })

    it('enriches the local pull-request context with a validated worktree linked issue', async () => {
      const worktreeId = `repo-1::${WORKTREE_FEATURE_PATH}`
      const linkedIssueDetails = {
        provider: 'github',
        number: 123,
        title: 'Improve PR generation',
        description: 'Include issue context.'
      }
      loadPullRequestLinkedIssueMock.mockResolvedValue(linkedIssueDetails)
      const linkedStore = {
        ...store,
        getWorktreeMeta: (id: string) => (id === worktreeId ? { linkedIssue: 123 } : undefined)
      }

      registerFilesystemHandlers(linkedStore as never)

      await handlers.get('git:generatePullRequestFields')!(null, {
        ...PULL_REQUEST_ARGS,
        worktreePath: WORKTREE_FEATURE_PATH,
        worktreeId,
        provider: 'github'
      })

      expect(generatePullRequestFieldsFromContextMock).toHaveBeenCalledWith(
        {
          ...PULL_REQUEST_CONTEXT,
          linkedIssue: 123,
          provider: 'github',
          linkedIssueDetails
        },
        params,
        expect.objectContaining({ kind: 'local' })
      )
    })

    it('ignores a pull-request worktree id that does not own the requested path', async () => {
      const getWorktreeMeta = vi.fn(() => ({ linkedIssue: 123 }))

      registerFilesystemHandlers({ ...store, getWorktreeMeta } as never)

      await handlers.get('git:generatePullRequestFields')!(null, {
        ...PULL_REQUEST_ARGS,
        worktreePath: WORKTREE_FEATURE_PATH,
        worktreeId: `repo-1::${path.resolve('/workspace/repo-other')}`
      })

      expect(getWorktreeMeta).not.toHaveBeenCalled()
      // Why: without the length guard the property assertion passes vacuously on `undefined`,
      // so an unrelated early return would read as "enrichment correctly suppressed".
      expect(generatePullRequestFieldsFromContextMock.mock.calls).toHaveLength(1)
      expect(generatePullRequestFieldsFromContextMock.mock.calls[0]?.[0]).not.toHaveProperty(
        'linkedIssue'
      )
    })
  })

  it('returns a sanitized error when local agent account preparation fails', async () => {
    const context = {
      branch: 'feature/ai',
      stagedSummary: 'M\tREADME.md',
      stagedPatch: '+hello'
    }
    const params = { agentId: 'codex', model: 'gpt-5.4-mini', thinkingLevel: 'low' }
    resolveCommitMessageSettingsMock.mockReturnValue({ ok: true, params })
    getStagedCommitContextMock.mockResolvedValue(context)

    registerFilesystemHandlers(store as never, {
      prepareForCodexLaunch: () => {
        throw new Error('failed to read /Users/alice/.codex/auth.json')
      }
    })

    await expect(
      handlers.get('git:generateCommitMessage')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH
      })
    ).resolves.toEqual({
      success: false,
      error: 'Failed to prepare the selected agent account for commit message generation.'
    })
    expect(generateCommitMessageFromContextMock).not.toHaveBeenCalled()
  })

  it('prepares the selected Claude auth environment before local generation', async () => {
    const previousAnthropicApiKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'do-not-leak-managed-auth-conflict'
    const context = {
      branch: 'feature/ai',
      stagedSummary: 'M\tREADME.md',
      stagedPatch: '+hello'
    }
    const params = { agentId: 'claude', model: 'haiku' }
    resolveCommitMessageSettingsMock.mockReturnValue({ ok: true, params })
    getStagedCommitContextMock.mockResolvedValue(context)
    generateCommitMessageFromContextMock.mockResolvedValue({
      success: true,
      message: 'Update README'
    })

    try {
      registerFilesystemHandlers(store as never, {
        prepareForClaudeLaunch: async () => ({
          configDir: '/managed/claude',
          envPatch: { CLAUDE_CONFIG_DIR: '/managed/claude' },
          stripAuthEnv: true,
          provenance: 'managed:account-1'
        })
      })

      await handlers.get('git:generateCommitMessage')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH
      })

      const target = generateCommitMessageFromContextMock.mock.calls[0]?.[2] as
        | { env?: NodeJS.ProcessEnv }
        | undefined
      expect(target?.env).toEqual(
        expect.objectContaining({
          CLAUDE_CONFIG_DIR: '/managed/claude'
        })
      )
      expect(target?.env?.ANTHROPIC_API_KEY).toBeUndefined()
    } finally {
      if (previousAnthropicApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY
      } else {
        process.env.ANTHROPIC_API_KEY = previousAnthropicApiKey
      }
    }
  })

  it('passes per-agent command overrides into local model discovery', async () => {
    discoverCommitMessageModelsLocalMock.mockResolvedValue({
      success: true,
      capability: {
        id: 'codex',
        label: 'Codex',
        modelSource: 'dynamic',
        defaultModelId: 'gpt-5.5',
        models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }]
      },
      models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
      defaultModelId: 'gpt-5.5'
    })
    const storeWithOverride = {
      ...store,
      getSettings: () => ({
        workspaceDir: WORKSPACE_DIR,
        agentCmdOverrides: { codex: 'npx codex' }
      })
    }

    registerFilesystemHandlers(storeWithOverride as never)

    await handlers.get('git:discoverCommitMessageModels')!(null, { agentId: 'codex' })

    expect(discoverCommitMessageModelsLocalMock).toHaveBeenCalledWith(
      'codex',
      undefined,
      'npx codex'
    )
  })

  it('discovers models from an exact repo-less folder workspace root', async () => {
    const folderPath = path.resolve('/outside-workspace/folder-project')
    const folderStore = {
      ...store,
      getFolderWorkspaces: () => [
        {
          id: 'folder-1',
          projectGroupId: 'group-1',
          folderPath,
          connectionId: null
        }
      ]
    }
    discoverCommitMessageModelsLocalMock.mockResolvedValue({
      success: true,
      models: [{ id: 'sonnet', label: 'Sonnet' }],
      defaultModelId: 'sonnet'
    })

    registerFilesystemHandlers(folderStore as never)

    await handlers.get('git:discoverCommitMessageModels')!(null, {
      agentId: 'claude',
      worktreePath: folderPath
    })

    expect(discoverCommitMessageModelsLocalMock).toHaveBeenCalledWith(
      'claude',
      undefined,
      undefined,
      { cwd: folderPath }
    )
  })

  it('routes a repo-less WSL folder workspace discovery through its distro', async () => {
    await withPlatform('win32', async () => {
      const folderPath = '\\\\wsl.localhost\\Ubuntu\\home\\tester\\folder-project'
      const prepareForClaudeLaunch = vi.fn().mockResolvedValue({
        configDir: '\\\\wsl.localhost\\Ubuntu\\home\\tester\\.claude',
        envPatch: { CLAUDE_CONFIG_DIR: '/home/tester/.claude' },
        stripAuthEnv: true,
        provenance: 'managed:account-1'
      })
      const folderStore = {
        ...store,
        getFolderWorkspaces: () => [
          {
            id: 'folder-1',
            projectGroupId: 'group-1',
            folderPath,
            connectionId: null
          }
        ]
      }
      discoverCommitMessageModelsLocalMock.mockResolvedValue({
        success: true,
        models: [{ id: 'sonnet', label: 'Sonnet' }],
        defaultModelId: 'sonnet'
      })

      registerFilesystemHandlers(folderStore as never, { prepareForClaudeLaunch })

      await handlers.get('git:discoverCommitMessageModels')!(null, {
        agentId: 'claude',
        worktreePath: folderPath
      })

      expect(prepareForClaudeLaunch).toHaveBeenCalledWith({
        runtime: 'wsl',
        wslDistro: 'Ubuntu'
      })
      expect(discoverCommitMessageModelsLocalMock).toHaveBeenCalledWith(
        'claude',
        expect.objectContaining({ CLAUDE_CONFIG_DIR: '/home/tester/.claude' }),
        undefined,
        { cwd: path.resolve(folderPath), wslDistro: 'Ubuntu' }
      )
    })
  })

  it('routes local WSL project model discovery through the project runtime target', async () => {
    await withPlatform('win32', async () => {
      discoverCommitMessageModelsLocalMock.mockResolvedValue({
        success: true,
        capability: {
          id: 'codex',
          label: 'Codex',
          modelSource: 'dynamic',
          defaultModelId: 'gpt-5.5',
          models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }]
        },
        models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
        defaultModelId: 'gpt-5.5'
      })
      const prepareForCodexLaunch = vi.fn(() => '\\\\wsl.localhost\\Ubuntu\\home\\tester\\.codex')
      const wslStore = {
        ...store,
        getRepos: () => [
          {
            id: 'repo-1',
            path: WORKTREE_FEATURE_PATH,
            displayName: 'repo',
            badgeColor: '#000',
            addedAt: 0
          }
        ],
        getProjects: () => [
          {
            id: 'project-1',
            sourceRepoIds: ['repo-1'],
            localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' }
          }
        ],
        getSettings: () => ({
          workspaceDir: WORKSPACE_DIR,
          agentCmdOverrides: { codex: 'npx codex' },
          localWindowsRuntimeDefault: { kind: 'windows-host' }
        })
      }

      registerFilesystemHandlers(wslStore as never, { prepareForCodexLaunch })

      await handlers.get('git:discoverCommitMessageModels')!(null, {
        agentId: 'codex',
        worktreePath: WORKTREE_FEATURE_PATH
      })

      expect(prepareForCodexLaunch).toHaveBeenCalledWith({
        runtime: 'wsl',
        wslDistro: 'Ubuntu'
      })
      expect(discoverCommitMessageModelsLocalMock).toHaveBeenCalledWith(
        'codex',
        expect.objectContaining({ CODEX_HOME: '/home/tester/.codex' }),
        'npx codex',
        { cwd: WORKTREE_FEATURE_PATH, wslDistro: 'Ubuntu' }
      )
    })
  })

  it('does not call the generator when no staged changes exist', async () => {
    resolveCommitMessageSettingsMock.mockReturnValue({
      ok: true,
      params: { agentId: 'codex', model: 'gpt-5.4-mini' }
    })
    getStagedCommitContextMock.mockResolvedValue(null)

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('git:generateCommitMessage')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH
      })
    ).resolves.toEqual({ success: false, error: 'No staged changes to summarize.' })

    expect(generateCommitMessageFromContextMock).not.toHaveBeenCalled()
  })

  it('sanitizes local staged-context read failures before returning to the renderer', async () => {
    resolveCommitMessageSettingsMock.mockReturnValue({
      ok: true,
      params: { agentId: 'codex', model: 'gpt-5.4-mini' }
    })
    getStagedCommitContextMock.mockRejectedValue(new Error('fatal: /secret/repo failed'))

    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('git:generateCommitMessage')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH
      })
    ).resolves.toEqual({ success: false, error: 'Failed to read staged changes.' })

    expect(generateCommitMessageFromContextMock).not.toHaveBeenCalled()
  })

  it('rejects git:commit with empty message and does not call commitChanges', async () => {
    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('git:commit')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH,
        message: ''
      })
    ).rejects.toThrow('Commit message is required')

    expect(commitChangesMock).not.toHaveBeenCalled()
  })

  it('rejects git:commit with whitespace-only message and does not call commitChanges', async () => {
    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('git:commit')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH,
        message: '   '
      })
    ).rejects.toThrow('Commit message is required')

    expect(commitChangesMock).not.toHaveBeenCalled()
  })

  it('allows git operations on worktrees outside repo/workspace roots', async () => {
    // Linked worktrees can live anywhere on disk (e.g. ~/.codex/worktrees/).
    // As long as the path matches a worktree reported by `git worktree list`
    // for a registered repo, it should be allowed — the security boundary is
    // worktree registration, not directory containment.
    const externalWorktreePath = path.resolve('/external/worktrees/feature')
    listWorktreesMock.mockResolvedValue([
      {
        path: REPO_PATH,
        head: 'abc',
        branch: 'refs/heads/main',
        isBare: false,
        isMainWorktree: true
      },
      {
        path: externalWorktreePath,
        head: 'def',
        branch: 'refs/heads/feature',
        isBare: false,
        isMainWorktree: false
      }
    ])

    getBranchCompareMock.mockResolvedValue({
      summary: {
        baseRef: 'origin/main',
        baseOid: 'base-oid',
        compareRef: 'feature',
        headOid: 'head-oid',
        mergeBase: 'merge-base-oid',
        changedFiles: 0,
        status: 'ready'
      },
      entries: []
    })

    registerFilesystemHandlers(store as never)

    await handlers.get('git:branchCompare')!(null, {
      worktreePath: externalWorktreePath,
      baseRef: 'origin/main'
    })

    expect(getBranchCompareMock).toHaveBeenCalledWith(externalWorktreePath, 'origin/main', {})
  })

  it('rejects branchCompare for a worktree added after cache was built, then succeeds after invalidation', async () => {
    // Reproduces the bug where CLI-created worktrees fail with
    // "Access denied: unknown repository or worktree path" because the
    // filesystem-auth cache was not invalidated after creation.
    const cliWorktreePath = path.resolve('/external/cli-created-worktree')

    // Step 1: register handlers and trigger initial cache build with only
    // the original worktree in the listing.
    registerFilesystemHandlers(store as never)

    // Warm the cache by calling a git operation on the existing worktree.
    getStatusMock.mockResolvedValue({ entries: [] })
    await handlers.get('git:status')!(null, { worktreePath: WORKTREE_FEATURE_PATH })

    // Step 2: simulate the CLI creating a new worktree — git now lists it,
    // but the auth cache is stale.
    listWorktreesMock.mockResolvedValue([
      {
        path: WORKTREE_FEATURE_PATH,
        head: 'abc',
        branch: '',
        isBare: false,
        isMainWorktree: false
      },
      {
        path: cliWorktreePath,
        head: 'def',
        branch: 'refs/heads/cli-feature',
        isBare: false,
        isMainWorktree: false
      }
    ])

    // Step 3: branchCompare on the new worktree should fail — this is the
    // exact error the user reported.
    await expect(
      handlers.get('git:branchCompare')!(null, {
        worktreePath: cliWorktreePath,
        baseRef: 'origin/main'
      })
    ).rejects.toThrow('Access denied: unknown repository or worktree path')

    // Step 4: invalidate the cache (what our fix does after CLI create).
    invalidateAuthorizedRootsCache()

    // Step 5: the same branchCompare should now succeed.
    getBranchCompareMock.mockResolvedValue({
      summary: {
        baseRef: 'origin/main',
        baseOid: 'base-oid',
        compareRef: 'cli-feature',
        headOid: 'head-oid',
        mergeBase: 'merge-base-oid',
        changedFiles: 0,
        status: 'ready'
      },
      entries: []
    })

    await handlers.get('git:branchCompare')!(null, {
      worktreePath: cliWorktreePath,
      baseRef: 'origin/main'
    })

    expect(getBranchCompareMock).toHaveBeenCalledWith(cliWorktreePath, 'origin/main', {})
  })

  it('routes branch diff queries through the pinned branch diff helper', async () => {
    getBranchDiffMock.mockResolvedValue({
      kind: 'text',
      originalContent: 'left',
      modifiedContent: 'right',
      originalIsBinary: false,
      modifiedIsBinary: false
    })

    registerFilesystemHandlers(store as never)

    await handlers.get('git:branchDiff')!(null, {
      worktreePath: WORKTREE_FEATURE_PATH,
      compare: {
        baseRef: 'origin/main',
        baseOid: 'base-oid',
        headOid: 'head-oid',
        mergeBase: 'merge-base-oid'
      },
      filePath: 'src/file.ts',
      oldPath: 'src/old-file.ts'
    })

    // Why: validateGitRelativeFilePath uses path.relative() which produces
    // platform-specific separators (backslashes on Windows).
    expect(getBranchDiffMock).toHaveBeenCalledWith(
      WORKTREE_FEATURE_PATH,
      {
        headOid: 'head-oid',
        mergeBase: 'merge-base-oid',
        filePath: path.join('src', 'file.ts'),
        oldPath: path.join('src', 'old-file.ts')
      },
      {}
    )
  })

  // Why: the original SSH Quick Open bug had two halves — relay-side policy
  // drift AND the main dispatcher silently dropping excludePaths before the
  // provider saw them. This test guards the second half: regardless of
  // relay behavior, a new linked worktree under the root must be forwarded
  // so the remote scan can prune it. See docs/design/share-quick-open-file-listing.md.
  // Why #7721: without a cancel path, every workspace switch left the previous
  // workspace's full-tree SSH scan running, stacking scans on the relay until
  // interactive fs.readDir/fs.stat starved past their 30s timeout.
})
