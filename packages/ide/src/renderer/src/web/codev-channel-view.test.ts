import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  closeCodevChannel,
  getCodevChannelId,
  openCodevChannel,
  resetCodevChannelViewForTest,
  subscribeCodevChannel
} from './codev-channel-view'

afterEach(() => {
  resetCodevChannelViewForTest()
})

describe('codev channel view', () => {
  it('starts with the chat in the center', () => {
    expect(getCodevChannelId()).toBeNull()
  })

  it('opens a channel and returns to the chat', () => {
    openCodevChannel('channel-1')
    expect(getCodevChannelId()).toBe('channel-1')
    closeCodevChannel()
    expect(getCodevChannelId()).toBeNull()
  })

  it('notifies subscribers only when the open channel actually changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCodevChannel(listener)

    openCodevChannel('channel-1')
    openCodevChannel('channel-1')
    expect(listener).toHaveBeenCalledTimes(1)

    openCodevChannel('channel-2')
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    closeCodevChannel()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
