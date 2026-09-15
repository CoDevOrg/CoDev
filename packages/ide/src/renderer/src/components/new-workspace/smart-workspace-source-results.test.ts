import { describe, expect, it } from 'vitest'
import {
  SMART_WORKSPACE_SOURCE_QUERY_MAX_BYTES,
  getBranchSearchRequest,
  getSmartWorkspaceEmptyHint,
  getVisibleBranchResults,
  getVisibleHeldProviderResults,
  isSmartWorkspaceSourceQueryWithinLimit,
  shouldHoldSourceResultsForQuery
} from './smart-workspace-source-results'

describe('Branch source results', () => {
  it('requests empty-query branch results in Branch mode', () => {
    expect(
      getBranchSearchRequest({
        disabled: false,
        textOnly: false,
        mode: 'branches',
        selectedRepoId: 'repo-1',
        query: '',
        limit: 12
      })
    ).toEqual({ repoId: 'repo-1', query: '', limit: 12 })
  })

  it('does not request branch results when branches are disabled', () => {
    expect(
      getBranchSearchRequest({
        branchesEnabled: false,
        disabled: false,
        textOnly: false,
        mode: 'branches',
        selectedRepoId: 'repo-1',
        query: '',
        limit: 12
      })
    ).toBeNull()
    expect(
      getBranchSearchRequest({
        branchesEnabled: false,
        disabled: false,
        textOnly: false,
        mode: 'smart',
        selectedRepoId: 'repo-1',
        query: 'refund',
        limit: 12
      })
    ).toBeNull()
  })

  it('keeps Smart mode in its start-typing state for an empty query', () => {
    expect(
      getBranchSearchRequest({
        disabled: false,
        textOnly: false,
        mode: 'smart',
        selectedRepoId: 'repo-1',
        query: '',
        limit: 12
      })
    ).toBeNull()
  })

  it('rejects oversized pasted branch queries before provider search planning', () => {
    expect(
      getBranchSearchRequest({
        disabled: false,
        textOnly: false,
        mode: 'smart',
        selectedRepoId: 'repo-1',
        query: 'x'.repeat(4096),
        limit: 12
      })
    ).toBeNull()
  })

  it('rejects oversized whitespace before trimming branch queries', () => {
    expect(
      getBranchSearchRequest({
        disabled: false,
        textOnly: false,
        mode: 'branches',
        selectedRepoId: 'repo-1',
        query: ' '.repeat(SMART_WORKSPACE_SOURCE_QUERY_MAX_BYTES + 1),
        limit: 12
      })
    ).toBeNull()
  })

  it('hides branch results after the input is cleared while a prior query is still held', () => {
    expect(
      getVisibleBranchResults({
        mode: 'branches',
        value: '',
        selectedRepoId: 'repo-1',
        resultRepoId: 'repo-1',
        resultQuery: 'feature',
        branches: [{ refName: 'origin/feature', localBranchName: 'feature' }]
      })
    ).toEqual([])
  })

  it('keeps the last branch results while the user types ahead of the settled query', () => {
    expect(
      getVisibleBranchResults({
        mode: 'branches',
        value: 'featu',
        selectedRepoId: 'repo-1',
        resultRepoId: 'repo-1',
        resultQuery: 'feat',
        branches: [{ refName: 'origin/feature', localBranchName: 'feature' }]
      })
    ).toEqual([{ refName: 'origin/feature', localBranchName: 'feature' }])
  })

  it('keeps the last branch results while the user trims a prefix of the settled query', () => {
    expect(
      getVisibleBranchResults({
        mode: 'branches',
        value: 'fe',
        selectedRepoId: 'repo-1',
        resultRepoId: 'repo-1',
        resultQuery: 'feat',
        branches: [{ refName: 'origin/feature', localBranchName: 'feature' }]
      })
    ).toEqual([{ refName: 'origin/feature', localBranchName: 'feature' }])
  })

  it('hides held branch results when the live query diverges from the settled query', () => {
    expect(
      getVisibleBranchResults({
        mode: 'branches',
        value: 'bug',
        selectedRepoId: 'repo-1',
        resultRepoId: 'repo-1',
        resultQuery: 'feat',
        branches: [{ refName: 'origin/feature', localBranchName: 'feature' }]
      })
    ).toEqual([])
  })

  it('drops a short settled query once the live query grows far beyond a typing delta', () => {
    // Why: prefix-only hold would keep "f" results under "fix-unrelated-payment-bug".
    expect(
      getVisibleBranchResults({
        mode: 'branches',
        value: 'fix-unrelated-payment-bug',
        selectedRepoId: 'repo-1',
        resultRepoId: 'repo-1',
        resultQuery: 'f',
        branches: [{ refName: 'origin/foo', localBranchName: 'foo' }]
      })
    ).toEqual([])
    expect(
      shouldHoldSourceResultsForQuery({ resultQuery: 'f', value: 'fix-unrelated-payment-bug' })
    ).toBe(false)
    expect(shouldHoldSourceResultsForQuery({ resultQuery: 'feat', value: 'featu' })).toBe(true)
    expect(shouldHoldSourceResultsForQuery({ resultQuery: 'feat', value: 'feature/x' })).toBe(false)
  })

  it('keeps held branch results across case-only edits of a prefix query', () => {
    expect(
      getVisibleBranchResults({
        mode: 'branches',
        value: 'Feat',
        selectedRepoId: 'repo-1',
        resultRepoId: 'repo-1',
        resultQuery: 'feat',
        branches: [{ refName: 'origin/feature', localBranchName: 'feature' }]
      })
    ).toEqual([{ refName: 'origin/feature', localBranchName: 'feature' }])
  })

  it('hides held provider results immediately when the field is cleared ahead of debounce', () => {
    expect(
      getVisibleHeldProviderResults({
        items: [{ id: 'pr-1' }],
        value: '',
        debouncedQuery: 'fix'
      })
    ).toEqual([])
  })

  it('keeps held provider results while the user types ahead of debounce', () => {
    expect(
      getVisibleHeldProviderResults({
        items: [{ id: 'pr-1' }],
        value: 'fix',
        debouncedQuery: 'fi'
      })
    ).toEqual([{ id: 'pr-1' }])
  })

  it('shows provider results once the cleared field and debounce are both empty', () => {
    expect(
      getVisibleHeldProviderResults({
        items: [{ id: 'default-1' }],
        value: '',
        debouncedQuery: ''
      })
    ).toEqual([{ id: 'default-1' }])
  })

  it('keeps matching empty-query branch results visible in Branch mode', () => {
    expect(
      getVisibleBranchResults({
        mode: 'branches',
        value: '',
        selectedRepoId: 'repo-1',
        resultRepoId: 'repo-1',
        resultQuery: '',
        branches: [{ refName: 'origin/main', localBranchName: 'main' }]
      })
    ).toEqual([{ refName: 'origin/main', localBranchName: 'main' }])
  })

  it('hides branch results for oversized pasted values before trimming', () => {
    expect(
      getVisibleBranchResults({
        mode: 'branches',
        value: ' '.repeat(SMART_WORKSPACE_SOURCE_QUERY_MAX_BYTES + 1),
        selectedRepoId: 'repo-1',
        resultRepoId: 'repo-1',
        resultQuery: '',
        branches: [{ refName: 'origin/main', localBranchName: 'main' }]
      })
    ).toEqual([])
  })

  it('describes empty Branch results after the empty-query search runs', () => {
    expect(getSmartWorkspaceEmptyHint('branches')).toBe('No matching branches.')
  })

})

describe('source query byte limits', () => {
  it('measures provider-search limits as UTF-8 bytes', () => {
    expect(isSmartWorkspaceSourceQueryWithinLimit('abc', 3)).toBe(true)
    expect(isSmartWorkspaceSourceQueryWithinLimit('😀', 3)).toBe(false)
    expect(
      isSmartWorkspaceSourceQueryWithinLimit(
        'é'.repeat(SMART_WORKSPACE_SOURCE_QUERY_MAX_BYTES / 2 + 1)
      )
    ).toBe(false)
  })
})

