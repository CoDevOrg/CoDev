import { describe, expect, it } from 'vitest'
import {
  countNewMessages,
  mergeChannelMessages,
  olderPageCursor,
  pageMayHaveMore
} from './codev-channel-transcript'

const m = (id: string, at: string) => ({ id, createdAt: at, body: `body ${id}` })

describe('mergeChannelMessages', () => {
  it('does not duplicate a just-sent message that a poll already included', () => {
    const polled = [m('a', '2026-09-12T07:00:00Z'), m('b', '2026-09-12T07:00:05Z')]
    const merged = mergeChannelMessages(polled, [m('b', '2026-09-12T07:00:05Z')])
    expect(merged.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('keeps a sent message that a poll started before the send does not know about', () => {
    const shown = [m('a', '2026-09-12T07:00:00Z'), m('sent', '2026-09-12T07:00:09Z')]
    const stalePoll = [m('a', '2026-09-12T07:00:00Z')]
    expect(mergeChannelMessages(shown, stalePoll).map((entry) => entry.id)).toEqual(['a', 'sent'])
  })

  it('prepends an older page in time order', () => {
    const shown = [m('c', '2026-09-12T07:00:10Z')]
    const older = [m('a', '2026-09-12T06:59:00Z'), m('b', '2026-09-12T06:59:30Z')]
    expect(mergeChannelMessages(shown, older).map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })

  it('takes the newer copy of an edited row', () => {
    const merged = mergeChannelMessages(
      [{ ...m('a', '2026-09-12T07:00:00Z'), body: 'old' }],
      [{ ...m('a', '2026-09-12T07:00:00Z'), body: 'new' }]
    )
    expect(merged[0]?.body).toBe('new')
  })
})

describe('paging', () => {
  it('uses the oldest loaded message as the cursor for the page before it', () => {
    expect(olderPageCursor([m('a', '2026-09-12T06:59:00Z'), m('b', '2026-09-12T07:00:00Z')])).toBe(
      '2026-09-12T06:59:00Z'
    )
    expect(olderPageCursor([])).toBeNull()
  })

  it('treats a full page as possibly having more and a short one as the end', () => {
    expect(pageMayHaveMore(Array.from({ length: 60 }))).toBe(true)
    expect(pageMayHaveMore(Array.from({ length: 12 }))).toBe(false)
  })
})

describe('countNewMessages', () => {
  it('counts only ids the reader has not seen', () => {
    const before = [m('a', '2026-09-12T07:00:00Z')]
    const after = [...before, m('b', '2026-09-12T07:00:01Z'), m('c', '2026-09-12T07:00:02Z')]
    expect(countNewMessages(before, after)).toBe(2)
    expect(countNewMessages(after, after)).toBe(0)
  })
})
