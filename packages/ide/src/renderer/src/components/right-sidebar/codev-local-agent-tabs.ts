import { parsePaneKey } from '../../../../shared/stable-pane-id'

export type MissionControlTab = {
  id: string
  worktreeId?: string
  title?: string
  generatedTitle?: string | null
  launchAgent?: string
  viewMode?: 'terminal' | 'chat'
  createdAt?: number
}

/**
 * Host snapshots can omit launchAgent for a restored chat. Preserve the
 * provider when the durable tab label still carries the provider identity,
 * then fall back to the workspace default for genuinely unlabelled tabs.
 */
export function resolveLocalTabAgent(tab: MissionControlTab, fallbackAgent: string): string {
  if (tab.launchAgent?.trim()) {
    return tab.launchAgent.trim()
  }

  const label = `${tab.generatedTitle ?? ''} ${tab.title ?? ''}`.trim()
  if (/^claude(?:[-_ ]|$)/i.test(label)) {
    return 'claude'
  }
  if (/^codex(?:[-_ ]|$)/i.test(label)) {
    return 'codex'
  }
  return fallbackAgent
}

/**
 * A restored status row can retain Codex as its compatibility owner while its
 * generated Claude identity is still the only provider evidence available.
 * Only recognize the generated `claude-<id>` form; ordinary task text must not
 * override an explicit provider.
 */
export function resolveLocalStatusAgent(
  agentType: string | undefined,
  terminalTitle: string | undefined,
  prompt: string | undefined
): string {
  const explicitAgent = agentType?.trim()
  if (
    explicitAgent?.toLowerCase() === 'codex' &&
    [terminalTitle, prompt].some((value) => /^claude-[a-z0-9]{8,}$/i.test(value?.trim() ?? ''))
  ) {
    return 'claude'
  }
  return explicitAgent || 'agent'
}

/**
 * A freshly launched or restored chat can exist before its provider emits a
 * hook status event. It is still an agent session — the tab metadata is the
 * same trusted launch identity used by the native-chat resolver and the
 * workspace bootstrap. Return only tabs that do not already have a status
 * row, so the hook-backed row remains authoritative once it arrives.
 */
export function localAgentTabsWithoutStatus(
  tabsByWorktree: Record<string, readonly MissionControlTab[]>,
  statuses: Record<string, { agentType?: string }>
): { worktreeId: string; tab: MissionControlTab }[] {
  const statusTabIds = new Set(
    Object.keys(statuses)
      .map((paneKey) => parsePaneKey(paneKey)?.tabId)
      .filter((tabId): tabId is string => Boolean(tabId))
  )

  return Object.entries(tabsByWorktree).flatMap(([worktreeId, tabs]) =>
    tabs
      .filter(
        (tab) => (Boolean(tab.launchAgent) || tab.viewMode === 'chat') && !statusTabIds.has(tab.id)
      )
      .map((tab) => ({ worktreeId, tab }))
  )
}
