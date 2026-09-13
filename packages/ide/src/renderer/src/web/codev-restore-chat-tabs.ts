import { activateWorktreeFromSidebar } from '@/lib/sidebar-worktree-activation'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { useAppStore } from '@/store'
import { isCodevAgentWorktree } from './codev-launch-agent-worktree'
import { isCodevEmbedded } from './codev-embedded'
import { worktreeHasAgentTab } from './codev-default-chat-tab'

/** How long to keep watching for the host to mirror its tabs before giving up
 *  on retiring the stock terminal the chat tab replaces. */
const RETIRE_STOCK_TABS_INTERVAL_MS = 1_500
const RETIRE_STOCK_TABS_ATTEMPTS = 12

/**
 * Settle the worktree on its chat tab: front the chat as soon as it exists,
 * then close the stock terminal tab(s) it replaces.
 *
 * CoDev workspaces are agent-first, so the worktree should open on the chat
 * tab alone — not the chat tab plus the idle shell the host created first.
 *
 * Fronting is separate from retiring because they become possible at different
 * moments. The host creates its shell first and mirrors its tab list
 * asynchronously, so for the first seconds of a new workspace the stock shell
 * is the active tab; waiting for the retire to close it meant a member's first
 * ever look at a workspace was a raw prompt, with the chat one click away
 * behind "Back to chat". Front the chat on the first poll that sees one, and
 * close shells on whichever later poll finds both.
 *
 * A paired host mirrors its tab list asynchronously, so the shell frequently
 * does not exist yet when the launch is issued (an earlier version captured
 * the tab ids up front and therefore had nothing to retire). Re-check a few
 * times instead, and only ever close a tab once an agent tab is actually
 * present, so a failed launch cannot leave the worktree empty.
 */
export function settleWorktreeOnChatTab(worktreeId: string): void {
  let attempt = 0
  // Front once: after that the member owns the choice, and a later poll must
  // not yank them out of a terminal they deliberately opened.
  let fronted = false
  let timer: ReturnType<typeof setInterval> | null = null
  let done = false
  const stop = (): void => {
    done = true
    if (timer !== null) {
      clearInterval(timer)
    }
  }
  const tick = (): void => {
    if (done) {
      return
    }
    attempt += 1
    const state = useAppStore.getState()
    const tabs = state.tabsByWorktree[worktreeId] ?? []
    // Why not `tab.launchAgent` alone: a paired host mirrors its tabs back with
    // launchAgent unset, so on CoDev every tab looked like a plain shell,
    // `agentTabs` was always empty, and this retired nothing — stock shells
    // accumulated in the worktree instead. `viewMode` survives the round trip.
    const chatTabIds = new Set<string>()
    for (const tab of state.unifiedTabsByWorktree?.[worktreeId] ?? []) {
      if (tab.viewMode !== 'chat') {
        continue
      }
      chatTabIds.add(tab.id)
      if (tab.entityId) {
        chatTabIds.add(tab.entityId)
      }
    }
    const isAgentTab = (tab: { id: string; launchAgent?: unknown }): boolean =>
      Boolean(tab.launchAgent) || chatTabIds.has(tab.id)
    const agentTabs = tabs.filter(isAgentTab)
    const shells = tabs.filter((tab) => !isAgentTab(tab))
    const chatTab = agentTabs[0]
    if (!fronted && chatTab) {
      fronted = true
      state.setActiveTabForWorktree(worktreeId, chatTab.id)
      if (state.activeWorktreeId === worktreeId) {
        state.setActiveTab(chatTab.id)
      }
    }
    if (agentTabs.length > 0 && shells.length > 0) {
      const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
      for (const shell of shells) {
        state.closeTab(shell.id, { reason: 'cleanup' })
        if (runtimeEnvironmentId) {
          // A paired host owns its tab list and re-mirrors anything closed
          // only in the client, so the close has to reach the host too.
          void import('@/runtime/web-runtime-session').then(({ closeWebRuntimeSessionTab }) =>
            closeWebRuntimeSessionTab({
              worktreeId,
              tabId: shell.id,
              environmentId: runtimeEnvironmentId,
              reason: 'cleanup'
            })
          )
        }
      }
      stop()
      return
    }
    if (attempt >= RETIRE_STOCK_TABS_ATTEMPTS) {
      stop()
    }
  }
  // Run once now: the first interval alone is 1.5s of stock terminal on screen
  // when the chat tab is already there to be fronted.
  tick()
  if (!done) {
    timer = setInterval(tick, RETIRE_STOCK_TABS_INTERVAL_MS)
  }
}

/**
 * Put this worktree's agent tabs back into chat.
 *
 * The launch-time decision only covers tabs created after it. A workspace
 * opened before that fix — or any tab whose `viewMode` the paired host stored
 * as `terminal` — comes back as a raw agent TUI on every reload, which is the
 * surface CoDev exists to replace. Opening a workspace is the moment to
 * re-assert the default; a member can still toggle to the terminal from the
 * tab afterwards for the rest of the session.
 */
export function ensureAgentTabsRenderAsChat(worktreeId: string): void {
  const state = useAppStore.getState()
  const agentTabIds = new Set(
    (state.tabsByWorktree[worktreeId] ?? [])
      .filter((tab) => Boolean(tab.launchAgent))
      .map((tab) => tab.id)
  )
  if (agentTabIds.size === 0) {
    return
  }

  const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  for (const tab of state.unifiedTabsByWorktree?.[worktreeId] ?? []) {
    const isAgentTab = agentTabIds.has(tab.entityId) || agentTabIds.has(tab.id)
    if (!isAgentTab || tab.viewMode === 'chat') {
      continue
    }
    state.setTabViewMode(tab.id, 'chat')
    if (runtimeEnvironmentId) {
      // The host keeps its own copy and wins on the next hydration, so tell it
      // too — otherwise this repair is undone by the following reload.
      void import('@/runtime/web-runtime-session').then(({ setWebRuntimeTabProps }) =>
        setWebRuntimeTabProps({ worktreeId, tabId: tab.id, viewMode: 'chat' })
      )
    }
  }
}

/**
 * Put an already-running conversation back on screen, without ever starting a
 * new one. Returns whether it found anything to restore.
 *
 * This is what a workspace open does now: landing a member in a session some
 * default picked for them is the thing they asked us to stop. A reload that
 * mirrors a live session must still return them to it, which is this half —
 * creating is `launchCodevDefaultChatTab`, and only a person triggers that.
 */
export function restoreCodevChatTabs({ worktreeId }: { worktreeId: string }): boolean {
  if (!isCodevEmbedded()) {
    return false
  }
  const store = useAppStore.getState()
  const base = store.allWorktrees?.().find((entry: { id: string }) => entry.id === worktreeId)

  if (base?.repoId) {
    const restorable = (store.worktreesByRepo[base.repoId] ?? [])
      .filter((entry) => isCodevAgentWorktree(entry))
      .filter((entry) => worktreeHasAgentTab(entry.id))
    if (restorable.length > 0) {
      for (const wt of restorable) {
        ensureAgentTabsRenderAsChat(wt.id)
        settleWorktreeOnChatTab(wt.id)
      }
      settleWorktreeOnChatTab(worktreeId)
      // The chat lives in the agent's own worktree, but the workspace opens on
      // the base checkout — whose shell was just retired. Without this the
      // member is left staring at an empty covered checkout while a perfectly
      // healthy conversation sits one (invisible) worktree away.
      const target = restorable[0]
      if (target && useAppStore.getState().activeWorktreeId !== target.id) {
        void activateWorktreeFromSidebar(target.id)
      }
      return true
    }
  }

  if (worktreeHasAgentTab(worktreeId)) {
    ensureAgentTabsRenderAsChat(worktreeId)
    settleWorktreeOnChatTab(worktreeId)
    return true
  }

  // Nothing to restore. Still retire the stock shell the host opened the
  // checkout with, so the member lands on the empty state rather than a raw
  // prompt they did not ask for.
  settleWorktreeOnChatTab(worktreeId)
  return false
}
