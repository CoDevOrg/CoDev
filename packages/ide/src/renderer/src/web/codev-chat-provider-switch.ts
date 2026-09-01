import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { useAppStore } from '@/store'
import type { AgentType } from '../../../shared/agent-status-types'
import type { CodevDefaultChatAgent } from './codev-bootstrap'
import { isCodevEmbedded } from './codev-embedded'
import { launchCodevAgentInOwnWorktree } from './codev-launch-agent-worktree'

function worktreeIdForTerminalTab(tabId: string): string | null {
  const { tabsByWorktree } = useAppStore.getState()
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    if (tabs.some((tab) => tab.id === tabId)) {
      return worktreeId
    }
  }
  return null
}

/**
 * An agent the in-chat provider switcher can offer as a destination. Broader
 * than `CodevDefaultChatAgent` (which is host-injected for every member) —
 * Cursor is member-linked (BYOK), so it's only ever offered once that link is
 * confirmed present (`__CODEV_CURSOR_AVAILABLE__`).
 */
export type CodevChatSwitchableAgent = CodevDefaultChatAgent | 'cursor'

/**
 * Providers CoDev lets a member switch a chat tab between, in menu order.
 * Callable from anywhere, including node test environments and any
 * server-side render: no window means no Cursor credential signal, never a
 * throw.
 */
export function codevChatProviders(
  win?: { __CODEV_CURSOR_AVAILABLE__?: boolean }
): readonly CodevChatSwitchableAgent[] {
  const target = win ?? (typeof window === 'undefined' ? undefined : window)
  return target?.__CODEV_CURSOR_AVAILABLE__ === true
    ? ['claude', 'codex', 'cursor']
    : ['claude', 'codex']
}

export function isCodevChatProvider(
  agent: AgentType | null | undefined,
  win?: { __CODEV_CURSOR_AVAILABLE__?: boolean }
): agent is CodevChatSwitchableAgent {
  return agent != null && codevChatProviders(win).includes(agent as CodevChatSwitchableAgent)
}

/** True in CoDev-embedded mode, where the in-chat provider switcher is offered. */
export function codevChatProviderSwitchEnabled(): boolean {
  return isCodevEmbedded()
}

/** The provider the tab is not on, for a one-tap toggle affordance. */
export function otherCodevChatProvider(
  agent: CodevDefaultChatAgent
): CodevDefaultChatAgent {
  return agent === 'claude' ? 'codex' : 'claude'
}

const RETIRE_PREVIOUS_TAB_DELAY_MS = 2_000

/**
 * Switch a native chat tab's provider.
 *
 * CoDev chat tabs each run one agent CLI in their PTY, so a switch means
 * starting a fresh chat on the new provider in the same worktree and retiring
 * the current tab. `launchAgentInNewTab` activates the new tab immediately
 * (local) or once the paired host mirrors it (web runtime); the retirement of
 * the previous tab is deferred and re-checked so it never leaves the worktree
 * without a tab while that mirror is in flight. If the check still cannot
 * confirm a replacement, the previous tab is left for the member to close.
 */
export function switchCodevChatProvider(args: {
  terminalTabId: string
  nextAgent: CodevChatSwitchableAgent
}): void {
  const { terminalTabId, nextAgent } = args
  const worktreeId = worktreeIdForTerminalTab(terminalTabId)
  if (!worktreeId) {
    return
  }

  // Every CoDev agent gets its own worktree, so switching provider starts the
  // new provider in a fresh worktree off the workspace's current checkout, not
  // in this agent's tree. The previous tab (and, once empty, its worktree) is
  // retired by the existing close path below.
  const createdInOwnWorktree = isCodevEmbedded()
    ? launchCodevAgentInOwnWorktree({
        agent: nextAgent,
        baseWorktreeId: worktreeId,
        launchSource: 'new_workspace_composer'
      })
    : null

  if (!createdInOwnWorktree) {
    launchAgentInNewTab({
      agent: nextAgent,
      worktreeId,
      promptDelivery: 'draft',
      launchSource: 'new_workspace_composer'
    })
  }

  setTimeout(() => {
    const state = useAppStore.getState()
    const tabs = state.tabsByWorktree[worktreeId] ?? []
    const previousStillOpen = tabs.some((tab) => tab.id === terminalTabId)
    if (previousStillOpen && tabs.length > 1) {
      state.closeTab(terminalTabId, { reason: 'user' })
    }
  }, RETIRE_PREVIOUS_TAB_DELAY_MS)
}
