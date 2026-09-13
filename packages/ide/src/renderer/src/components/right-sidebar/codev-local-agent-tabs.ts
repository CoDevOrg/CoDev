import { parseLegacyNumericPaneKey, parsePaneKey } from '../../../../shared/stable-pane-id'

/**
 * The tab a status row belongs to, whichever pane-key form the row uses.
 * Retained rows still carry the legacy `<tabId>:<n>` shape next to the stable
 * `<tabId>:<leaf-uuid>` one, and every Mission Control decision — counting,
 * de-duplicating, stepping in, stopping — has to resolve both to the same tab
 * or the same agent shows up twice, or not at all.
 */
export function tabIdFromPaneKey(paneKey: string): string | null {
  return parsePaneKey(paneKey)?.tabId ?? parseLegacyNumericPaneKey(paneKey)?.tabId ?? null
}

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
 *
 * Only a status row that will itself render as an agent suppresses the tab.
 * A row with no `agentType` is a plain terminal pane or a half-torn-down
 * entry: the container drops it from the status list, so treating it as
 * authoritative here made a real chat vanish from Mission Control entirely.
 */
export function localAgentTabsWithoutStatus(
  tabsByWorktree: Record<string, readonly MissionControlTab[]>,
  statuses: Record<string, { agentType?: string }>
): { worktreeId: string; tab: MissionControlTab }[] {
  const statusTabIds = new Set(
    Object.entries(statuses)
      .filter(([, entry]) => Boolean(entry.agentType))
      .map(([paneKey]) => tabIdFromPaneKey(paneKey))
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
