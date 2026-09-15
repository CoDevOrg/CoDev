import { describe, expect, it } from 'vitest'
import {
  buildGitHubWorkspaceSource,
  buildWorkspaceSourceSelection,
  getWorkspaceSourceName,
  getWorkspaceSourceProvider,
  shouldApplyWorkspaceSourceAutoName,
  shouldPreserveWorkspaceSourceOnRepoChange
} from './workspace-source'

describe('workspace source policy', () => {
  const issue = buildGitHubWorkspaceSource({
    type: 'issue',
    number: 42,
    title: 'Ship mobile parity',
    url: 'https://github.com/acme/app/issues/42',
    repoId: 'repo-1'
  })

  it('builds one GitHub identity for desktop and mobile create flows', () => {
    expect(issue).toEqual({
      provider: 'github',
      type: 'issue',
      number: 42,
      title: 'Ship mobile parity',
      url: 'https://github.com/acme/app/issues/42',
      repoId: 'repo-1'
    })
    expect(getWorkspaceSourceName(issue)).toEqual({
      seedName: 'ship-mobile-parity',
      displayName: 'Ship mobile parity'
    })
  })

  it('never preserves repo-scoped sources across repo changes', () => {
    expect(shouldPreserveWorkspaceSourceOnRepoChange(issue)).toBe(false)
    // Why: a null source (branch-only) has nothing to preserve; callers guard on this.
    expect(shouldPreserveWorkspaceSourceOnRepoChange(null)).toBe(false)
  })

  it('shares provider inference, selection labels, and auto-name gates', () => {
    const legacyItem = {
      type: 'pr' as const,
      number: 7,
      title: 'Self hosted',
      url: 'https://github.example.com/g/p/pull/7'
    }
    expect(getWorkspaceSourceProvider(legacyItem)).toBe('github')
    expect(buildWorkspaceSourceSelection({ linkedWorkItem: legacyItem })).toMatchObject({
      kind: 'github-pr',
      label: '#7 Self hosted'
    })
    expect(buildWorkspaceSourceSelection({ linkedWorkItem: null, baseBranch: 'main' })).toEqual({
      kind: 'branch',
      label: 'main'
    })
    expect(shouldApplyWorkspaceSourceAutoName({ currentName: '#42', lastAutoName: 'old' })).toBe(
      true
    )
    expect(
      shouldApplyWorkspaceSourceAutoName({ currentName: 'my workspace', lastAutoName: 'old' })
    ).toBe(false)
  })
})
