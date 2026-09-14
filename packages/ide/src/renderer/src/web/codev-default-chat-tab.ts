import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { isNativeChatSupportedAgent } from '@/lib/native-chat-supported-agent'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../shared/types'
import type { CodevDefaultChatAgent } from './codev-bootstrap'
import { clearCodevAgentLaunching, markCodevAgentLaunching } from './codev-agent-launch-state'
import { isCodevEmbedded } from './codev-embedded'
import { isCodevAgentWorktree, launchCodevAgentInOwnWorktree } from './codev-launch-agent-worktree'
import {
  ensureAgentTabsRenderAsChat,
  restoreCodevChatTabs,
  settleWorktreeOnChatTab
} from './codev-restore-chat-tabs'

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
  pendingWorktreeCreations?: Record<string, { status: 'creating' | 'error'; error?: string }>
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
  for (const creation of Object.values(state.pendingWorktreeCreations ?? {})) {
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
 * Start a new session in the just-activated worktree and retire the stock
 * terminal tab(s) it replaces. Only ever called because a person chose an
 * agent — the workspace-open path uses `restoreCodevChatTabs` instead. Reuses
 * the same launch path as the tab-bar quick-launch so paired (web-runtime)
 * sessions spawn the agent on the host correctly.
 */
export function launchCodevDefaultChatTab({
  worktreeId,
  agent: requested
}: {
  worktreeId: string
  /** Explicit choice from a picker. Omitted only by the workspace-open
   *  bootstrap, which has nobody to ask yet. */
  agent?: TuiAgent
}): void {
  const agent = requested ?? codevDefaultChatAgent()
  if (!agent) {
    console.warn('CoDev resolved no default chat agent', {
      embedded: isCodevEmbedded(),
      pinned: window.__CODEV_DEFAULT_AGENT__
    })
    return
  }

  // Every branch below is fire-and-forget, so this is the only point that
  // reliably means "launching"; the wait decides when it stops.
  markCodevAgentLaunching(worktreeId)
  void waitForCodevDefaultChatTab({ worktreeId })
    .catch((error: unknown) => {
      console.warn('CoDev could not observe the default chat launch', error)
    })
    .finally(() => {
      clearCodevAgentLaunching(worktreeId)
    })

  // A live conversation wins over starting another one.
  if (restoreCodevChatTabs({ worktreeId })) {
    return
  }

  const store = useAppStore.getState()
  const base = store.allWorktrees?.().find((entry: { id: string }) => entry.id === worktreeId)

  // Every CoDev agent runs in its own worktree so two agents never edit the
  // same tree.
  if (base?.repoId) {
    // Agent worktrees exist but none of them has a chat. Relaunch in the first
    // one rather than stacking yet another worktree per attempt.
    const stranded = (store.worktreesByRepo[base.repoId] ?? []).find((entry) =>
      isCodevAgentWorktree(entry)
    )
    if (stranded) {
      console.warn('CoDev is relaunching the agent in a stranded worktree', {
        worktreeId: stranded.id
      })
      launchAgentInNewTab({
        agent,
        worktreeId: stranded.id,
        launchSource: 'new_workspace_composer'
      })
      settleWorktreeOnChatTab(stranded.id)
      settleWorktreeOnChatTab(worktreeId)
      return
    }

    const creationId = launchCodevAgentInOwnWorktree({
      agent,
      baseWorktreeId: worktreeId,
      launchSource: 'new_workspace_composer'
    })
    // The main checkout stays a plain tree; drop the shell the host opened it
    // with so it isn't a stray idle terminal.
    settleWorktreeOnChatTab(worktreeId)
    if (creationId) {
      return
    }
    // The worktree create could not be started — fall through to an in-place
    // launch so a workspace never opens with zero agents.
  }

  waitForHostWorktreeTabs(worktreeId, () => {
    if (worktreeHasAgentTab(worktreeId)) {
      ensureAgentTabsRenderAsChat(worktreeId)
      settleWorktreeOnChatTab(worktreeId)
      return
    }
    launchAgentInNewTab({ agent, worktreeId, launchSource: 'new_workspace_composer' })
    settleWorktreeOnChatTab(worktreeId)
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
