import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  consumeCodevSurfaceFocus,
  getCodevSurfaceFocus,
  requestCodevSurfaceFocus,
  resetCodevSurfaceFocusForTest,
  subscribeCodevSurfaceFocus
} from './codev-surface-focus'

afterEach(() => {
  resetCodevSurfaceFocusForTest()
})

describe('codev surface focus', () => {
  it('hands a request only to the surface it names', () => {
    requestCodevSurfaceFocus({ kind: 'mission-control-agent', sessionId: 's1' })
    expect(getCodevSurfaceFocus('mission-control-agent')?.target.sessionId).toBe('s1')
    expect(getCodevSurfaceFocus('review-checkpoint')).toBeNull()
  })

  it('is consumed once and ignores a stale consume after a newer request', () => {
    const first = requestCodevSurfaceFocus({ kind: 'review-checkpoint', sessionId: 'a' })
    const second = requestCodevSurfaceFocus({ kind: 'review-checkpoint', sessionId: 'b' })
    consumeCodevSurfaceFocus(first)
    expect(getCodevSurfaceFocus('review-checkpoint')?.target.sessionId).toBe('b')
    consumeCodevSurfaceFocus(second)
    expect(getCodevSurfaceFocus('review-checkpoint')).toBeNull()
  })

  it('notifies subscribers on request and on consume', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCodevSurfaceFocus(listener)
    const id = requestCodevSurfaceFocus({ kind: 'mission-control-agent', sessionId: 's1' })
    consumeCodevSurfaceFocus(id)
    consumeCodevSurfaceFocus(id)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})
