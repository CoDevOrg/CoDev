import type { Worktree, WorktreeMeta } from '../../shared/types'

type LinkedWorkItemMetadata = Pick<Worktree, 'linkedWorkItem' | 'linkedTaskSourceContext'>

export function getLinkedWorkItemMetadata(meta: WorktreeMeta | undefined): LinkedWorkItemMetadata {
  return {
    linkedWorkItem: meta?.linkedWorkItem ?? null,
    linkedTaskSourceContext: meta?.linkedTaskSourceContext ?? null
  }
}
