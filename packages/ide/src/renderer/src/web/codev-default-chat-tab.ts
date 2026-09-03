import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { activateWorktreeFromSidebar } from '@/lib/sidebar-worktree-activation'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { isNativeChatSupportedAgent } from '@/lib/native-chat-supported-agent'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../shared/types'
import type { CodevDefaultChatAgent } from './codev-bootstrap'
import { isCodevEmbedded } from './codev-embedded'
import { isCodevAgentWorktree, launchCodevAgentInOwnWorktree } from './codev-launch-agent-worktree'

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

/** On a return visit the paired host mirrors this worktree's existing tabs
 *  asynchronously. Wait this long for the mirror to produce *something* before
 *  opening a fresh default chat, so a member who left a conversation running
 *  comes back to it rather than to an empty chat stacked on top of it. */
const HOST_TAB_MIRROR_INTERVAL_MS = 750
const HOST_TAB_MIRROR_ATTEMPTS = 10

/**
 * Resolve the agent for the workspace's default chat tab. Returns `null`
 * outside CoDev-embedded mode so the caller stays a no-op for stock Orca.
 */
export function codevDefaultChatAgent(): TuiAgent | null {
  if (!isCodevEmbedded()) {
    return null
  }
  const pinned = window.__CODEV_DEFAULT_AGENT__
  const agent: TuiAgent =
    pinned === 'claude' || pinned === 'codex' ? pinned : CODEV_DEFAULT_CHAT_AGENT
  return isNativeChatSupportedAgent(agent) ? agent : null
}

/**
 * True when the worktree already owns an agent tab — a reload that mirrored a
 * still-running session, or a chat tab this bootstrap opened on a previous
 * pass. Opening another default chat tab on top of it would duplicate the
 * surface, so the caller skips.
 *
 * Takes the state slice explicitly (rather than reading the store itself) so
 * a reactive caller can pass a `useAppStore` selector's snapshot and re-render
 * when the answer changes — e.g. hiding a "waiting for your agent" cover the
 * instant the real chat tab appears.
 */
export function worktreeHasAgentTabInState(
  worktreeId: string,
  state: {
    tabsByWorktree: Record<string, { launchAgent?: unknown }[]>
    unifiedTabsByWorktree?: Record<string, { viewMode?: string }[]>
  }
): boolean {
  const legacyTabs = state.tabsByWorktree[worktreeId] ?? []
  if (legacyTabs.some((tab) => Boolean(tab.launchAgent))) {
    return true
  }
  const unifiedTabs = state.unifiedTabsByWorktree?.[worktreeId] ?? []
  return unifiedTabs.some((tab) => tab.viewMode === 'chat')
}

export function worktreeHasAgentTab(worktreeId: string): boolean {
  return worktreeHasAgentTabInState(worktreeId, useAppStore.getState())
}

/** Poll cadence/budget for `waitForCodevDefaultChatTab`. A cold agent worktree
 *  has to clone, run inherited setup, and spawn the agent on the host, so the
 *  budget is generous — the wait ends early on success or on a failed create. */
const CHAT_TAB_WAIT_INTERVAL_MS = 1_000
const CHAT_TAB_WAIT_ATTEMPTS = 60

type CodevChatTabWaitState = {
  tabsByWorktree: Record<string, { launchAgent?: unknown }[]>
  unifiedTabsByWorktree?: Record<string, { viewMode?: string }[]>
  worktreesByRepo: Record<string, { id: string; isMainWorktree?: boolean; branch?: string }[]>
  pendingWorktreeCreations: Record<string, { status: 'creating' | 'error'; error?: string }>
  allWorktrees?: () => { id: string; repoId?: string }[]
}

/**
 * True when this workspace has a chat surface a member can actually land on:
 * one in the base checkout, or one in any of the per-agent worktrees CoDev
 * creates off it. The agent normally runs in its own worktree, so checking the
 * base checkout alone would report "no chat" for a perfectly healthy workspace.
 */
export function codevWorkspaceHasChatTabInState(
  state: CodevChatTabWaitState,
  baseWorktreeId: string
): boolean {
  if (worktreeHasAgentTabInState(baseWorktreeId, state)) {
    return true
  }
  const base = state.allWorktrees?.().find((entry) => entry.id === baseWorktreeId)
  if (!base?.repoId) {
    return false
  }
  return (state.worktreesByRepo[base.repoId] ?? [])
    .filter((worktree) => isCodevAgentWorktree(worktree))
    .some((worktree) => worktreeHasAgentTabInState(worktree.id, state))
}

/** The error text of a worktree create that already failed, if any. */
export function failedCodevWorktreeCreationError(state: CodevChatTabWaitState): string | null {
  for (const creation of Object.values(state.pendingWorktreeCreations)) {
    if (creation.status === 'error') {
      return creation.error ?? 'The agent worktree could not be created.'
    }
  }
  return null
}

/**
 * Resolve once this workspace actually has a chat surface.
 *
 * `launchCodevDefaultChatTab` is fire-and-forget — it kicks off a background
 * worktree create and returns immediately — so a resolved launch proves
 * nothing. Callers that report the project as ready must wait for this instead,
 * or a silent launch failure is announced to the parent page as success and the
 * member is dropped onto an empty workspace.
 *
 * Only a *reported* failure resolves false. Running out of patience does not:
 * the agent's worktree inherits the repo's setup script, so a first create on a
 * large repo can sit in `pnpm install` for minutes. Returning false there would
 * make the parent page tear down a perfectly healthy IDE and replace it with
 * "Could not open the workspace". The in-IDE awaiting cover is the right place
 * for a slow start — it explains itself and offers a retry without discarding
 * the session.
 */
export async function waitForCodevDefaultChatTab({
  worktreeId
}: {
  worktreeId: string
}): Promise<boolean> {
  for (let attempt = 0; attempt < CHAT_TAB_WAIT_ATTEMPTS; attempt += 1) {
    const state = useAppStore.getState()
    if (codevWorkspaceHasChatTabInState(state, worktreeId)) {
      return true
    }
    const failure = failedCodevWorktreeCreationError(state)
    if (failure) {
      console.warn('CoDev could not create the agent worktree:', failure)
      return false
    }
    await new Promise((resolve) => window.setTimeout(resolve, CHAT_TAB_WAIT_INTERVAL_MS))
  }
  return true
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
    // Why not `tab.launchAgent` alone: a paired host mirrors its tabs back with
    // launchAgent unset, so on CoDev every tab looked like a plain shell,
    // `agentTabs` was always empty, and this retired nothing — stock shells
    // accumulated in the worktree instead. `viewMode` survives the round trip.
    const chatTabIds = new Set<string>()
    for (const tab of state.unifiedTabsByWorktree?.[worktreeId] ?? []) {
      if (tab.viewMode !== 'chat') continue
      chatTabIds.add(tab.id)
      if (tab.entityId) chatTabIds.add(tab.entityId)
    }
    const isAgentTab = (tab: { id: string; launchAgent?: unknown }): boolean =>
      Boolean(tab.launchAgent) || chatTabIds.has(tab.id)
    const agentTabs = tabs.filter(isAgentTab)
    const shells = tabs.filter((tab) => !isAgentTab(tab))
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
  if (!agent) {
    console.warn('CoDev resolved no default chat agent', {
      embedded: isCodevEmbedded(),
      pinned: window.__CODEV_DEFAULT_AGENT__
    })
    return
  }

  const store = useAppStore.getState()
  const base = store.allWorktrees?.().find((entry: { id: string }) => entry.id === worktreeId)

  // Every CoDev agent runs in its own worktree so two agents never edit the
  // same tree. `startupWorktreeRefreshCompleted` gates this call in App.tsx, so
  // a prior session's agent worktrees are already mirrored into the store — on
  // reload, re-assert their chat view and retire stray shells rather than
  // spawning another.
  if (base?.repoId) {
    const existingAgentWorktrees = (store.worktreesByRepo[base.repoId] ?? []).filter((entry) =>
      isCodevAgentWorktree(entry)
    )
    // Only worktrees that actually carry a chat count as "already launched".
    // A worktree whose create finished but whose agent never spawned used to
    // satisfy this check by existing, so the workspace bailed out here on every
    // pass and no retry could ever escape it.
    const restorable = existingAgentWorktrees.filter((entry) => worktreeHasAgentTab(entry.id))
    if (restorable.length > 0) {
      for (const wt of restorable) {
        ensureAgentTabsRenderAsChat(wt.id)
        retireStockTerminalTabs(wt.id)
      }
      retireStockTerminalTabs(worktreeId)
      // The chat lives in the agent's own worktree, but the workspace opens on
      // the base checkout — whose shell was just retired. Without this the
      // member is left staring at an empty covered checkout while a perfectly
      // healthy conversation sits one (invisible) worktree away.
      const target = restorable[0]
      if (target && useAppStore.getState().activeWorktreeId !== target.id) {
        void activateWorktreeFromSidebar(target.id)
      }
      return
    }
    // Agent worktrees exist but none of them has a chat. Relaunch in the first
    // one rather than stacking yet another worktree per attempt.
    const stranded = existingAgentWorktrees[0]
    if (stranded) {
      console.warn('CoDev is relaunching the agent in a stranded worktree', {
        worktreeId: stranded.id
      })
      launchAgentInNewTab({
        agent,
        worktreeId: stranded.id,
        launchSource: 'new_workspace_composer'
      })
      retireStockTerminalTabs(stranded.id)
      retireStockTerminalTabs(worktreeId)
      return
    }

    const creationId = launchCodevAgentInOwnWorktree({
      agent,
      baseWorktreeId: worktreeId,
      launchSource: 'new_workspace_composer'
    })
    // The main checkout stays a plain tree; drop the shell the host opened it
    // with so it isn't a stray idle terminal.
    retireStockTerminalTabs(worktreeId)
    if (creationId) {
      return
    }
    // The worktree create could not be started — fall through to an in-place
    // launch so a workspace never opens with zero agents.
  }

  if (worktreeHasAgentTab(worktreeId)) {
    ensureAgentTabsRenderAsChat(worktreeId)
    retireStockTerminalTabs(worktreeId)
    return
  }
  waitForHostWorktreeTabs(worktreeId, () => {
    if (worktreeHasAgentTab(worktreeId)) {
      ensureAgentTabsRenderAsChat(worktreeId)
      retireStockTerminalTabs(worktreeId)
      return
    }
    launchAgentInNewTab({ agent, worktreeId, launchSource: 'new_workspace_composer' })
    retireStockTerminalTabs(worktreeId)
    setTimeout(() => ensureAgentTabsRenderAsChat(worktreeId), RETIRE_STOCK_TABS_INTERVAL_MS * 2)
  })
}

/**
 * Run `done` once the paired host has mirrored this worktree's tab set — i.e.
 * an agent tab has appeared (a running chat was restored), or any tab at all
 * has (the mirror landed and the worktree is genuinely without a chat), or the
 * bounded window elapsed (host is slow or the worktree really is empty). Keeps
 * `launchCodevDefaultChatTab` from stacking a fresh chat on a conversation the
 * host is still in the middle of mirroring back.
 */
function waitForHostWorktreeTabs(worktreeId: string, done: () => void): void {
  const mirrorReported = (): boolean => {
    const state = useAppStore.getState()
    if (worktreeHasAgentTab(worktreeId)) {
      return true
    }
    const legacy = state.tabsByWorktree[worktreeId] ?? []
    const unified = state.unifiedTabsByWorktree?.[worktreeId] ?? []
    return legacy.length > 0 || unified.length > 0
  }
  if (mirrorReported()) {
    done()
    return
  }
  let attempt = 0
  const timer = setInterval(() => {
    attempt += 1
    if (mirrorReported() || attempt >= HOST_TAB_MIRROR_ATTEMPTS) {
      clearInterval(timer)
      done()
    }
  }, HOST_TAB_MIRROR_INTERVAL_MS)
}
