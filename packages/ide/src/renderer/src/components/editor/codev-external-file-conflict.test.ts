import { describe, expect, it, vi } from 'vitest'
import {
  CODEV_EXTERNAL_FILE_CONFLICT_BANNER,
  CODEV_EXTERNAL_FILE_CONFLICT_LABEL,
  codevConflictPath,
  isCodevExternalFileConflict,
  reportCodevExternalFileConflict,
  resolveCodevExternalFileConflict
} from './codev-external-file-conflict'

const requestCodevBridge = vi.hoisted(() => vi.fn())
vi.mock('@/web/codev-bridge-singleton', () => ({
  requestCodevBridge
}))

const conflict = {
  worktreeId: '4dbbf95e-08fe-4a6f-84e9-a5d85000da8e',
  path: 'README.md',
  snapshotRevision: 'editor-r1',
  filesystemRevision: 'filesystem-r2',
  collaborativeContents: 'collaborative README',
  filesystemContents: 'terminal README'
}

describe('codev external file conflict', () => {
  it('keeps only a workspace-relative file path', () => {
    expect(codevConflictPath('/README.md')).toBe('README.md')
    expect(codevConflictPath('../secret')).toBeNull()
    expect(codevConflictPath('')).toBeNull()
  })

  it('accepts a preserved-both conflict snapshot', () => {
    expect(isCodevExternalFileConflict(conflict)).toBe(true)
    expect(isCodevExternalFileConflict({ path: 'README.md' })).toBe(false)
    expect(CODEV_EXTERNAL_FILE_CONFLICT_LABEL).toBe('External file conflict')
    expect(CODEV_EXTERNAL_FILE_CONFLICT_BANNER).toContain('Both versions are preserved')
  })

  it('reports the native editor buffer without sending an Orca worktree id', async () => {
    requestCodevBridge.mockResolvedValueOnce(conflict)

    await expect(
      reportCodevExternalFileConflict({
        path: 'README.md',
        collaborativeContents: 'collaborative README'
      })
    ).resolves.toEqual(conflict)
    expect(requestCodevBridge).toHaveBeenCalledWith('conflicts.report', {
      path: 'README.md',
      collaborativeContents: 'collaborative README'
    })
  })

  it('resolves through the workspace-bound bridge using the reported revisions', async () => {
    requestCodevBridge.mockResolvedValueOnce({ strategy: 'collaboration' })

    await resolveCodevExternalFileConflict({
      conflict,
      strategy: 'collaboration'
    })
    expect(requestCodevBridge).toHaveBeenCalledWith('conflicts.resolve', {
      path: 'README.md',
      strategy: 'collaboration',
      expectedSnapshotRevision: 'editor-r1',
      expectedFilesystemRevision: 'filesystem-r2'
    })
  })
})
