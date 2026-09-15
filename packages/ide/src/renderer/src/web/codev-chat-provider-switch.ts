import { useAppStore } from '@/store'
import type { AgentType } from '../../../shared/agent-status-types'
import type { CodevDefaultChatAgent } from './codev-bootstrap'
import { isCodevEmbedded } from './codev-embedded'
import { startCodevManagedAgentWithToast } from './codev-managed-agent'

function worktreeIdForTerminalTab(tabId: string): string | null {
  const { tabsByWorktree } = useAppStore.getState()
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    if (tabs.some((tab) => tab.id === tabId)) {
      return worktreeId
    }
  }
  return null
}

/** An agent the in-chat provider switcher can offer as a destination. */
export type CodevChatSwitchableAgent = CodevDefaultChatAgent

/** Providers CoDev lets a member switch a chat tab between, in menu order. */
export function codevChatProviders(): readonly CodevChatSwitchableAgent[] {
  return ['claude', 'codex']
}

export function isCodevChatProvider(
  agent: AgentType | null | undefined
): agent is CodevChatSwitchableAgent {
  return agent != null && codevChatProviders().includes(agent as CodevChatSwitchableAgent)
}

/**
 * CoDev uses the backend-managed agent as its only agent surface. Provider
 * changes happen from Mission Control and start a managed turn there; the
 * native Orca chat provider switcher must not create a local agent tab.
 */
export function codevChatProviderSwitchEnabled(): boolean {
  return false
}

/** The provider the tab is not on, for a one-tap toggle affordance. */
export function otherCodevChatProvider(agent: CodevDefaultChatAgent): CodevDefaultChatAgent {
  return agent === 'claude' ? 'codex' : 'claude'
}

/**
 * Switch the provider for the managed CoDev agent.
 *
 * Provider changes no longer create a local Orca chat tab. They start a new
 * managed CoDev session and leave Orca responsible for steering and review.
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
  if (!isCodevEmbedded()) {
    return
  }
  void startCodevManagedAgentWithToast({
    agent: nextAgent,
    baseWorktreeId: worktreeId
  }).catch(() => undefined)
}
