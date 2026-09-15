import type React from 'react'
import { ClaudeIcon, OpenAIIcon } from '@/components/status-bar/icons'
import type { TuiAgent } from '../../../shared/types'
import { getTuiAgentLaunchCommand, TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import { AgentLetterIcon } from './agent-icon-glyphs'
import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export type AgentCatalogEntry = {
  id: TuiAgent
  label: string
  /** Default CLI binary name used for PATH detection. */
  cmd: string
  /** Homepage/install docs URL, sourced from the README agent badge list. */
  homepageUrl: string
}

function getCatalogPlatform(): NodeJS.Platform {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (userAgent.includes('Windows')) {
    return 'win32'
  }
  if (userAgent.includes('Mac')) {
    return 'darwin'
  }
  if (userAgent) {
    return 'linux'
  }
  return typeof process === 'undefined' ? 'linux' : process.platform
}

export const getAgentCatalog = createLocalizedCatalog((): AgentCatalogEntry[] => [
  {
    id: 'claude',
    label: translate('auto.lib.agent.catalog.0708ed89f1', 'Claude'),
    cmd: 'claude',
    homepageUrl: 'https://docs.anthropic.com/claude/docs/claude-code'
  },
  {
    id: 'claude-agent-teams',
    label: translate('auto.lib.agent.catalog.bf53f09bf8', 'Claude Agent Teams'),
    cmd: getTuiAgentLaunchCommand(TUI_AGENT_CONFIG['claude-agent-teams'], getCatalogPlatform()),
    homepageUrl: 'https://code.claude.com/docs/agent-teams'
  },
  {
    id: 'codex',
    label: translate('auto.lib.agent.catalog.760bc6883d', 'Codex'),
    cmd: 'codex',
    homepageUrl: 'https://github.com/openai/codex'
  }
])

// Why: tests and a few legacy call sites still import a catalog snapshot.
export const AGENT_CATALOG: AgentCatalogEntry[] = getAgentCatalog()

export function getAgentLabel(agent: TuiAgent): string {
  return getAgentCatalog().find((entry) => entry.id === agent)?.label ?? agent
}

export function AgentIcon({
  agent,
  size = 14
}: {
  agent: TuiAgent | null | undefined
  size?: number
}): React.JSX.Element {
  // Why: render a neutral question-mark glyph when the agent identity is not
  // yet known. Before, the caller coerced null → 'claude', which caused Codex
  // panes to briefly show the Claude icon until the first hook callback
  // arrived.
  if (!agent) {
    return <AgentLetterIcon letter="?" size={size} />
  }
  if (agent === 'claude' || agent === 'claude-agent-teams') {
    return <ClaudeIcon size={size} />
  }
  if (agent === 'codex') {
    return <OpenAIIcon size={size} />
  }
  const catalogEntry = getAgentCatalog().find((a) => a.id === agent)
  const label = catalogEntry?.label ?? agent
  return <AgentLetterIcon letter={label.charAt(0).toUpperCase()} size={size} />
}
