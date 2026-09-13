/**
 * Unsent channel drafts, kept for the life of the workspace tab.
 *
 * The channel pane is remounted for every channel switch and every return to
 * the chat, and it held the composer text in component state — so clicking
 * another channel, or "Back to chat", threw away whatever was typed. Drafts
 * live here instead, keyed by channel, and the composer reads its own back on
 * mount. Deliberately not persisted to disk: a half-typed message is view
 * state, and one member's draft must never travel to a paired client.
 */
const drafts = new Map<string, string>()

export function getCodevChannelDraft(channelId: string): string {
  return drafts.get(channelId) ?? ''
}

export function setCodevChannelDraft(channelId: string, text: string): void {
  if (text) {
    drafts.set(channelId, text)
  } else {
    drafts.delete(channelId)
  }
}

/**
 * Puts a message the server did not accept back in front of the member
 * without overwriting anything typed while the send was in flight: the
 * failed body comes first, then whatever is in the composer now.
 */
export function restoreUnsentChannelMessage(failedBody: string, typedSince: string): string {
  const since = typedSince.trim()
  if (!since) {
    return failedBody
  }
  if (since === failedBody.trim()) {
    return failedBody
  }
  return `${failedBody}\n${typedSince}`
}

/** Test seam. */
export function resetCodevChannelDraftsForTest(): void {
  drafts.clear()
}
