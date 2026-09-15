import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/types'
import { getRepoHeaderCreateState } from './repo-header-create-state'

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'orca',
    badgeColor: '#999999',
    addedAt: 1,
    ...overrides
  }
}

describe('repo header create state', () => {
  it('allows local git repos', () => {
    expect(getRepoHeaderCreateState({ repo: makeRepo(), label: 'orca' })).toEqual({
      disabled: false,
      tooltip: 'Create new worktree for orca',
      ariaLabel: 'Create new worktree for orca'
    })
  })

  it('allows folder repos as workspace creates', () => {
    expect(
      getRepoHeaderCreateState({ repo: makeRepo({ kind: 'folder' }), label: 'docs' })
    ).toMatchObject({
      disabled: false,
      tooltip: 'Create workspace for docs'
    })
  })
})
