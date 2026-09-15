import { describe, expect, it } from 'vitest'
import { isWorkItemLookupText } from './work-item-lookup-text'

describe('isWorkItemLookupText', () => {
  it('detects GitHub PR and issue URLs', () => {
    expect(isWorkItemLookupText('https://github.com/stablyai/orca/pull/4900')).toBe(true)
    expect(isWorkItemLookupText('https://github.com/stablyai/orca/issues/123')).toBe(true)
    expect(isWorkItemLookupText('  https://www.github.com/stablyai/orca/pull/1 ')).toBe(true)
  })

  it('detects hash-number shorthand', () => {
    expect(isWorkItemLookupText('#4900')).toBe(true)
  })

  it('rejects deliberate workspace names', () => {
    expect(isWorkItemLookupText('')).toBe(false)
    expect(isWorkItemLookupText('   ')).toBe(false)
    expect(isWorkItemLookupText('my-feature')).toBe(false)
    expect(isWorkItemLookupText('fix-2')).toBe(false)
    expect(isWorkItemLookupText('terminal scrollbar polish')).toBe(false)
    expect(isWorkItemLookupText('https://example.com/some/page')).toBe(false)
  })
})
