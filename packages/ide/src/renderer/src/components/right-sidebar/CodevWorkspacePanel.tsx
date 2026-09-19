import { useCallback, useEffect, useState, type JSX } from 'react'
import { useAppStore } from '@/store'
import { useActiveRepo, useActiveWorktree } from '@/store/selectors'
import { CodevReviewCheckpointPanel } from '../sidebar/CodevReviewCheckpointPanel'
import { CodevBranchesOverview } from '../codev/CodevBranchesOverview'
import SourceControl from './SourceControl'

type WorkspaceSurface = 'branches' | 'changes'

/**
 * CoDev's single branch-action surface. The activity rail owns one entry;
 * these two lightweight views keep branch discovery and publishing in the
 * same place without forcing the user to understand Orca's desktop tabs.
 */
export function CodevWorkspacePanel(): JSX.Element {
  const rightSidebarTab = useAppStore((state) => state.rightSidebarTab)
  const setRightSidebarTab = useAppStore((state) => state.setRightSidebarTab)
  const openModal = useAppStore((state) => state.openModal)
  const activeRepo = useActiveRepo()
  const activeWorktree = useActiveWorktree()
  const [surface, setSurface] = useState<WorkspaceSurface>(() =>
    rightSidebarTab === 'source-control' ? 'changes' : 'branches'
  )

  useEffect(() => {
    setSurface(rightSidebarTab === 'source-control' ? 'changes' : 'branches')
  }, [rightSidebarTab])

  const selectSurface = useCallback(
    (next: WorkspaceSurface): void => {
      setSurface(next)
      setRightSidebarTab(next === 'changes' ? 'source-control' : 'codev-branches')
    },
    [setRightSidebarTab]
  )

  const openNewBranch = useCallback((): void => {
    if (!activeRepo) {
      return
    }
    const baseBranch = activeWorktree?.branch?.trim().replace(/^refs\/heads\//, '')
    openModal('new-workspace-composer', {
      initialRepoId: activeRepo.id,
      ...(baseBranch ? { initialBaseBranch: baseBranch } : {}),
      telemetrySource: 'unknown'
    })
  }, [activeRepo, activeWorktree?.branch, openModal])

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground"
      data-codev-workspace-panel="true"
      aria-label="Branches and pull requests"
    >
      <div className="flex shrink-0 items-center border-b border-border/70 px-3 py-2">
        <div
          className="inline-flex rounded-lg bg-muted p-1"
          role="tablist"
          aria-label="Branch workspace actions"
        >
          <button
            type="button"
            role="tab"
            aria-selected={surface === 'branches'}
            onClick={() => selectSurface('branches')}
            className={`min-h-9 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${surface === 'branches' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Branches
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={surface === 'changes'}
            onClick={() => selectSurface('changes')}
            className={`min-h-9 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${surface === 'changes' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Changes &amp; PR
          </button>
        </div>
      </div>

      {surface === 'branches' ? (
        <CodevBranchesOverview onCreateBranch={activeRepo ? openNewBranch : undefined} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CodevReviewCheckpointPanel surface="source-control" />
          <div className="min-h-0 flex-1 overflow-hidden">
            <SourceControl codevWorkspaceSurface />
          </div>
        </div>
      )}
    </section>
  )
}
