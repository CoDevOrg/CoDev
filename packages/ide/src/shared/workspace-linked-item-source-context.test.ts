import { describe, expect, it } from 'vitest'
import type { TaskSourceContext } from './task-source-context'
import type { WorkspaceLinkedItem } from './types'
import { isWorkspaceLinkedItemSourceContextMatch } from './workspace-linked-item-source-context'

const GITHUB_ITEM: WorkspaceLinkedItem = {
  provider: 'github',
  type: 'issue',
  number: 42,
  title: 'GitHub issue',
  url: 'https://github.com/acme/repo/issues/42'
}

const GITHUB_CONTEXT: TaskSourceContext = {
  kind: 'task-source',
  provider: 'github',
  projectId: 'project-1',
  hostId: 'local',
  providerIdentity: { provider: 'github', owner: 'acme', repo: 'repo' }
}

describe('workspace linked-item source context', () => {
  it('matches items to a context of the same provider', () => {
    expect(isWorkspaceLinkedItemSourceContextMatch(GITHUB_ITEM, GITHUB_CONTEXT)).toBe(true)
  })

  it('returns false when either side is missing', () => {
    expect(isWorkspaceLinkedItemSourceContextMatch(null, GITHUB_CONTEXT)).toBe(false)
    expect(isWorkspaceLinkedItemSourceContextMatch(GITHUB_ITEM, null)).toBe(false)
  })

  it('infers the GitHub provider when seeds omit provider', () => {
    expect(
      isWorkspaceLinkedItemSourceContextMatch(
        {
          type: 'issue',
          number: 42,
          title: 'GitHub issue',
          url: 'https://github.com/acme/repo/issues/42'
        },
        GITHUB_CONTEXT
      )
    ).toBe(true)
  })
})
