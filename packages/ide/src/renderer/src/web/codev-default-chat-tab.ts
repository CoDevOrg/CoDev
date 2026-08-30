import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { isNativeChatSupportedAgent } from '@/lib/native-chat-supported-agent'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../shared/types'
import type { CodevDefaultChatAgent } from './codev-bootstrap'
import { isCodevEmbedded } from './codev-embedded'

/**
 * The agent CoDev opens a workspace's default chat tab with when the pairing
 * fragment does not pin one. Claude is the safe default: its credential is
 * injected into every CoDev runtime host, and it renders in the native chat
 * surface.
 */
export const CODEV_DEFAULT_CHAT_AGENT: CodevDefaultChatAgent = 'claude'

/** How long to keep watching for the host to mirror its tabs before giving up
 *  on retiring the stock terminal the chat tab replaces. */
const RETIRE_STOCK_TABS_INTERVAL_MS = 1_500
const RETIRE_STOCK_TABS_ATTEMPTS = 12

/**
 * Resolve the agent for the workspace's default chat tab. Returns `null`
 * outside CoDev-embedded mode so the caller stays a no-op for stock Orca.
 */
export function codevDefaultChatAgent(): TuiAgent | null {
  if (!isCodevEmbedded()) {
    return null
  }
  const pinned = window.__CODEV_DEFAULT_AGENT__
  const agent: TuiAgent = pinned === 'claude' || pinned === 'codex' ? pinned : CODEV_DEFAULT_CHAT_AGENT
  return isNativeChatSupportedAgent(agent) ? agent : null
}

/**
 * True when the worktree already owns an agent tab — a reload that mirrored a
 * still-running session, or a chat tab this bootstrap opened on a previous
 * pass. Opening another default chat tab on top of it would duplicate the
 * surface, so the caller skips.
 */
export function worktreeHasAgentTab(worktreeId: string): boolean {
  const state = useAppStore.getState()
  const legacyTabs = state.tabsByWorktree[worktreeId] ?? []
  if (legacyTabs.some((tab) => Boolean(tab.launchAgent))) {
    return true
  }
  const unifiedTabs = state.unifiedTabsByWorktree?.[worktreeId] ?? []
  return unifiedTabs.some((tab) => tab.viewMode === 'chat')
}

/**
 * Close the stock terminal tab(s) the default chat tab replaces.
 *
 * CoDev workspaces are agent-first, so the worktree should open on the chat
 * tab alone — not the chat tab plus the idle shell the host created first.
 *
 * A paired host mirrors its tab list asynchronously, so the shell frequently
 * does not exist yet when the launch is issued (an earlier version captured
 * the tab ids up front and therefore had nothing to retire). Re-check a few
 * times instead, and only ever close a tab once an agent tab is actually
 * present, so a failed launch cannot leave the worktree empty.
 */
function retireStockTerminalTabs(worktreeId: string): void {
  let attempt = 0
  const timer = setInterval(() => {
    attempt += 1
    const state = useAppStore.getState()
    const tabs = state.tabsByWorktree[worktreeId] ?? []
    const agentTabs = tabs.filter((tab) => Boolean(tab.launchAgent))
    const shells = tabs.filter((tab) => !tab.launchAgent)
    if (agentTabs.length > 0 && shells.length > 0) {
      const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
      for (const shell of shells) {
        state.closeTab(shell.id, { reason: 'cleanup' })
        if (runtimeEnvironmentId) {
          // A paired host owns its tab list and re-mirrors anything closed
          // only in the client, so the close has to reach the host too.
          void import('@/runtime/web-runtime-session').then(
            ({ closeWebRuntimeSessionTab }) =>
              closeWebRuntimeSessionTab({
                worktreeId,
                tabId: shell.id,
                environmentId: runtimeEnvironmentId,
                reason: 'cleanup'
              })
          )
        }
      }
      clearInterval(timer)
      return
    }
    if (attempt >= RETIRE_STOCK_TABS_ATTEMPTS) {
      clearInterval(timer)
    }
  }, RETIRE_STOCK_TABS_INTERVAL_MS)
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
function ensureAgentTabsRenderAsChat(worktreeId: string): void {
  const state = useAppStore.getState()
  const agentTabIds = new Set(
    (state.tabsByWorktree[worktreeId] ?? [])
      .filter((tab) => Boolean(tab.launchAgent))
      .map((tab) => tab.id)
  )
  if (agentTabIds.size === 0) return

  const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  for (const tab of state.unifiedTabsByWorktree?.[worktreeId] ?? []) {
    const isAgentTab = agentTabIds.has(tab.entityId) || agentTabIds.has(tab.id)
    if (!isAgentTab || tab.viewMode === 'chat') continue
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
 * Open the workspace's default native chat tab in the just-activated worktree
 * and retire the stock terminal tab(s) it replaces. No-op outside
 * CoDev-embedded mode or when the worktree already has an agent tab. Reuses
 * the same launch path as the tab-bar quick-launch so paired (web-runtime)
 * sessions spawn the agent on the host correctly.
 */
export function launchCodevDefaultChatTab({ worktreeId }: { worktreeId: string }): void {
  const agent = codevDefaultChatAgent()
  if (!agent) return
  if (worktreeHasAgentTab(worktreeId)) {
    // Already has an agent. Still make sure it is not showing as a raw TUI,
    // and still retire any shell the host re-created alongside it — a reload
    // takes this path, and skipping the sweep is how a second idle terminal
    // came back every time.
    ensureAgentTabsRenderAsChat(worktreeId)
    retireStockTerminalTabs(worktreeId)
    return
  }
  launchAgentInNewTab({
    agent,
    worktreeId,
    // Deliberately no promptDelivery: `'draft'` means "there is unsent text to
    // mirror into the composer", and `decideInitialAgentTabViewMode` refuses
    // chat when that text is empty (canMirrorLaunchDraftToNativeChat('') is
    // false) — which silently opened this tab as a terminal. There is no
    // prompt here at all, so the default is both correct and opens in chat.
    launchSource: 'new_workspace_composer'
  })
  retireStockTerminalTabs(worktreeId)
  // The host mirrors tabs late, so re-assert once they land.
  setTimeout(() => ensureAgentTabsRenderAsChat(worktreeId), RETIRE_STOCK_TABS_INTERVAL_MS * 2)
}
