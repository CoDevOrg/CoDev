import { describe, expect, it } from 'vitest'
import { areWorkspaceLinkedItemsEqual } from './workspace-linked-item'
import type { WorkspaceLinkedItem } from './types'

const item: WorkspaceLinkedItem = {
  provider: 'github',
  type: 'issue',
  number: 123,
  title: 'Link GitHub',
  url: 'https://github.com/acme/app/issues/123',
  repoId: 'repo-1'
}

describe('areWorkspaceLinkedItemsEqual', () => {
  it('ignores key order and absent-vs-undefined optional fields', () => {
    expect(
      areWorkspaceLinkedItemsEqual(item, {
        repoId: 'repo-1',
        url: 'https://github.com/acme/app/issues/123',
        title: 'Link GitHub',
        number: 123,
        type: 'issue',
        provider: 'github'
      })
    ).toBe(true)
    expect(areWorkspaceLinkedItemsEqual({ ...item, repoId: undefined }, { ...item, repoId: undefined })).toBe(
      true
    )
  })

  it('treats both nullish items as equal and a one-sided item as different', () => {
    expect(areWorkspaceLinkedItemsEqual(null, undefined)).toBe(true)
    expect(areWorkspaceLinkedItemsEqual(item, null)).toBe(false)
  })

  it('separates items that differ by number, title, url, type, or repo', () => {
    expect(areWorkspaceLinkedItemsEqual(item, { ...item, number: 124 })).toBe(false)
    expect(areWorkspaceLinkedItemsEqual(item, { ...item, title: 'Renamed' })).toBe(false)
    expect(
      areWorkspaceLinkedItemsEqual(item, { ...item, url: 'https://github.com/acme/app/issues/1' })
    ).toBe(false)
    expect(areWorkspaceLinkedItemsEqual(item, { ...item, type: 'pr' })).toBe(false)
    expect(areWorkspaceLinkedItemsEqual(item, { ...item, repoId: 'repo-2' })).toBe(false)
  })
})
