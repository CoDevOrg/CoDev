import { requestCodevBridge } from '@/web/codev-bridge-singleton'

export const CODEV_EXTERNAL_FILE_CONFLICT_LABEL = 'External file conflict'
export const CODEV_EXTERNAL_FILE_CONFLICT_BANNER =
  'This file changed on disk while you have unsaved edits. Both versions are preserved. Choose one or merge them before continuing.'
export const CODEV_EXTERNAL_FILE_CONFLICT_COMPARE =
  'Both versions are preserved. Disk is on the left, your collaborative edits are on the right. Choose one or merge them before continuing.'

export type CodevExternalFileConflict = {
  worktreeId: string
  path: string
  snapshotRevision: string
  filesystemRevision: string
  collaborativeContents: string
  filesystemContents: string
}

export function codevConflictPath(relativePath: string): string | null {
  const path = relativePath.replace(/^\/+/, '').trim()
  if (
    !path ||
    path.includes('\0') ||
    path.split('/').some((part) => part === '.' || part === '..')
  ) {
    return null
  }
  return path
}

export function isCodevExternalFileConflict(
  value: unknown
): value is CodevExternalFileConflict {
  if (!value || typeof value !== 'object') {
    return false
  }
  const conflict = value as Record<string, unknown>
  return (
    typeof conflict.worktreeId === 'string' &&
    typeof conflict.path === 'string' &&
    typeof conflict.snapshotRevision === 'string' &&
    typeof conflict.filesystemRevision === 'string' &&
    typeof conflict.collaborativeContents === 'string' &&
    typeof conflict.filesystemContents === 'string'
  )
}

export async function reportCodevExternalFileConflict(input: {
  path: string
  collaborativeContents: string
}): Promise<CodevExternalFileConflict | null> {
  const path = codevConflictPath(input.path)
  if (!path) {
    return null
  }
  try {
    const payload = await requestCodevBridge<unknown>('conflicts.report', {
      path,
      collaborativeContents: input.collaborativeContents
    })
    return isCodevExternalFileConflict(payload) ? payload : null
  } catch {
    return null
  }
}

export async function resolveCodevExternalFileConflict(input: {
  conflict: CodevExternalFileConflict
  strategy: 'collaboration' | 'filesystem' | 'merged'
  mergedContents?: string
}): Promise<void> {
  await requestCodevBridge('conflicts.resolve', {
    path: input.conflict.path,
    strategy: input.strategy,
    expectedSnapshotRevision: input.conflict.snapshotRevision,
    expectedFilesystemRevision: input.conflict.filesystemRevision,
    ...(input.strategy === 'merged' ? { mergedContents: input.mergedContents ?? '' } : {})
  })
}
