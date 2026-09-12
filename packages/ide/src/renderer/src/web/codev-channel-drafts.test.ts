import { afterEach, describe, expect, it } from 'vitest'
import {
  getCodevChannelDraft,
  resetCodevChannelDraftsForTest,
  restoreUnsentChannelMessage,
  setCodevChannelDraft
} from './codev-channel-drafts'

afterEach(() => {
  resetCodevChannelDraftsForTest()
})

describe('codev channel drafts', () => {
  it('keeps a draft per channel across a switch and back', () => {
    setCodevChannelDraft('general', 'Unsent UI audit draft')
    setCodevChannelDraft('standup', 'blocked on the deploy')

    expect(getCodevChannelDraft('general')).toBe('Unsent UI audit draft')
    expect(getCodevChannelDraft('standup')).toBe('blocked on the deploy')
    expect(getCodevChannelDraft('random')).toBe('')
  })

  it('forgets a draft that was sent or cleared', () => {
    setCodevChannelDraft('general', 'hello')
    setCodevChannelDraft('general', '')
    expect(getCodevChannelDraft('general')).toBe('')
  })
})

describe('restoreUnsentChannelMessage', () => {
  it('returns the failed message when nothing was typed meanwhile', () => {
    expect(restoreUnsentChannelMessage('first try', '')).toBe('first try')
    expect(restoreUnsentChannelMessage('first try', '   ')).toBe('first try')
  })

  it('keeps what was typed during the send, after the failed message', () => {
    expect(restoreUnsentChannelMessage('first try', 'and more')).toBe('first try\nand more')
  })

  it('does not duplicate a body the member already retyped', () => {
    expect(restoreUnsentChannelMessage('first try', 'first try')).toBe('first try')
  })
})
