import { useSyncExternalStore } from 'react'

/**
 * Which team channel the workspace's center pane is showing, if any.
 *
 * A CoDev workspace has two things a member reads and writes in the middle of
 * the screen: the agent chat, and the team's channels. Channels used to open
 * *inside* the left rail, which made a conversation between people a
 * 240px-wide column while the agent got the whole screen — backwards for a
 * product whose point is that people and agents work in the same room.
 *
 * The channel now takes the center, layered over the chat rather than
 * replacing it in the pane model: the agent chat stays mounted underneath, so
 * switching back is instant and never disturbs a running session. The chat
 * remains the workspace's permanent center; a channel is a view the member
 * switches to and back from, not a tab that can displace it.
 *
 * The id lives here, outside the app store, because that store is persisted to
 * disk on every change and which channel somebody was reading is view state,
 * not session state worth restoring or risking hydration on.
 */
let activeChannelId: string | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeCodevChannel(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getCodevChannelId(): string | null {
  return activeChannelId
}

/** Shows `channelId` in the center pane. Passing null returns to the chat. */
export function openCodevChannel(channelId: string | null): void {
  if (activeChannelId === channelId) {
    return
  }
  activeChannelId = channelId
  emit()
}

export function closeCodevChannel(): void {
  openCodevChannel(null)
}

export function useCodevChannelId(): string | null {
  return useSyncExternalStore(subscribeCodevChannel, getCodevChannelId, getCodevChannelId)
}

/** Test seam: drops the open channel and every subscriber. */
export function resetCodevChannelViewForTest(): void {
  activeChannelId = null
  listeners.clear()
}
