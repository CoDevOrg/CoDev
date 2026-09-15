import type { Repo } from '../../../../shared/types'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { translate } from '@/i18n/i18n'

export type RepoHeaderCreateState = {
  disabled: boolean
  tooltip: string
  ariaLabel: string
}

export function getRepoHeaderCreateState(input: { repo: Repo; label: string }): RepoHeaderCreateState {
  if (!isGitRepoKind(input.repo)) {
    return {
      disabled: false,
      tooltip: translate(
        'auto.components.sidebar.repo.header.create.state.62e71f2d5d',
        'Create workspace for {{value0}}',
        { value0: input.label }
      ),
      ariaLabel: translate(
        'auto.components.sidebar.repo.header.create.state.62e71f2d5d',
        'Create workspace for {{value0}}',
        { value0: input.label }
      )
    }
  }

  return {
    disabled: false,
    tooltip: translate(
      'auto.components.sidebar.repo.header.create.state.992cfbc44b',
      'Create new worktree for {{value0}}',
      { value0: input.label }
    ),
    ariaLabel: translate(
      'auto.components.sidebar.repo.header.create.state.992cfbc44b',
      'Create new worktree for {{value0}}',
      { value0: input.label }
    )
  }
}
