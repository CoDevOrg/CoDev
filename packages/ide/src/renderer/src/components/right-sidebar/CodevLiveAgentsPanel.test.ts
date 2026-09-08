import { describe, expect, it } from 'vitest'
import { shouldRefreshCodevActivity } from './CodevLiveAgentsPanel'

describe('shouldRefreshCodevActivity', () => {
  it('polls only while the embedded Activity surface is visible', () => {
    expect(shouldRefreshCodevActivity(true, 'visible')).toBe(true)
    expect(shouldRefreshCodevActivity(true, 'hidden')).toBe(false)
    expect(shouldRefreshCodevActivity(false, 'visible')).toBe(false)
  })
})
