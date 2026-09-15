import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getFolderWorkspacePathStatus,
  getFolderWorkspacePathStatusForPath
} from './folder-workspace-path-status'
import type { ProjectGroup, Repo } from '../../shared/types'

function makeGroup(overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    id: 'group-1',
    name: 'Platform',
    parentPath: '/workspace/platform',
    parentGroupId: null,
    createdFrom: 'folder-scan',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/workspace/platform/api',
    displayName: 'api',
    badgeColor: 'gray',
    addedAt: 1,
    projectGroupId: 'group-1',
    ...overrides
  }
}

describe('folder workspace path status', () => {
  it('reports existing local directories and local files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-folder-status-'))
    try {
      const filePath = join(root, 'notes.txt')
      await writeFile(filePath, 'hello')

      await expect(
        getFolderWorkspacePathStatusForPath(
          {
            folderPath: root,
            projectGroupId: 'group-1',
            projectGroups: [makeGroup({ parentPath: root })],
            repos: []
          }
        )
      ).resolves.toEqual({ path: root, exists: true })

      await expect(
        getFolderWorkspacePathStatusForPath(
          {
            folderPath: filePath,
            projectGroupId: 'group-1',
            projectGroups: [makeGroup({ parentPath: filePath })],
            repos: []
          }
        )
      ).resolves.toEqual({ path: filePath, exists: false, reason: 'not-directory' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports missing local directories', async () => {
    const missingPath = join(tmpdir(), `orca-folder-status-missing-${randomUUID()}`)

    await expect(
      getFolderWorkspacePathStatusForPath(
        {
          folderPath: missingPath,
          projectGroupId: 'group-1',
          projectGroups: [makeGroup({ parentPath: missingPath })],
          repos: []
        }
      )
    ).resolves.toEqual({ path: missingPath, exists: false, reason: 'missing' })
  })

  it('supports direct path scope without a persisted project group', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-folder-status-direct-'))
    try {
      await expect(
        getFolderWorkspacePathStatus(
          {
            getRepos: () => [makeRepo({ path: join(root, 'api') })],
            getProjectGroups: () => [],
            getFolderWorkspaces: () => []
          },
          { scope: 'path', path: root }
        )
      ).resolves.toEqual({ path: root, exists: true })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
