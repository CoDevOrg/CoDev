import { useAppStore } from '@/store'
import { planLaunchAgentStartupPrompt } from '@/lib/launch-agent-startup-prompt-plan'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { getAgentLaunchPlatformForRepo } from '@/lib/agent-launch-platform'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import { resolveLocalWindowsAgentStartupShell } from '../../../shared/windows-terminal-shell'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import { repoIsRemote } from '../../../shared/agent-launch-remote'
import { resolveNativeChatSessionOptionDefaults } from '../../../shared/native-chat-session-option-defaults'
import type { TuiAgent } from '../../../shared/types'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'

/**
 * Shared startup-plan resolution for launching a TUI agent: platform, shell,
 * argv/env defaults, the CoDev per-member credential marker, and the
 * prompt-delivery plan. Factored out of `launchAgentInNewTab` so a launch that
 * first creates its own worktree (`codev-launch-agent-worktree.ts`) builds the
 * exact same plan.
 */
export type ResolvedAgentLaunchStartup = {
  resolvedLaunchPlatform: NodeJS.Platform
  isRemote: boolean
  startupPlanBase: {
    agent: TuiAgent
    cmdOverrides: Record<string, string>
    platform: NodeJS.Platform
    shell: ReturnType<typeof resolveLocalWindowsAgentStartupShell>
    isRemote: boolean
    agentArgs: string | null
    agentEnv: Record<string, string>
    sessionOptions: ReturnType<typeof resolveNativeChatSessionOptionDefaults>
  }
  startupPlan: AgentStartupPlan | null
  pasteDraftAfterLaunch: string | null
  submitPastedPrompt: boolean
  hasPrompt: boolean
  trimmedPrompt: string
  effectiveAgentArgs: string | null
  isFollowupPath: boolean
}

export function resolveAgentLaunchStartup(args: {
  agent: TuiAgent
  worktreeId: string
  prompt?: string
  promptDelivery: 'auto-submit' | 'draft' | 'submit-after-ready'
  agentArgs?: string | null
  launchPlatform?: NodeJS.Platform
}): ResolvedAgentLaunchStartup {
  const { agent, worktreeId, prompt, promptDelivery, agentArgs, launchPlatform } = args
  const store = useAppStore.getState()
  const worktree = store.allWorktrees?.().find((entry: { id: string }) => entry.id === worktreeId)
  const repo = worktree ? store.repos?.find((entry) => entry.id === worktree.repoId) : null
  const resolvedLaunchPlatform =
    launchPlatform ??
    (repo
      ? getAgentLaunchPlatformForRepo(
          repo,
          repo.connectionId ? undefined : getLocalProjectExecutionRuntimeContext(store, worktreeId)
        )
      : CLIENT_PLATFORM)
  const isRemote = repo ? repoIsRemote(repo) : false
  const queuedShell = resolveLocalWindowsAgentStartupShell({
    platform: resolvedLaunchPlatform,
    isRemote,
    terminalWindowsShell: store.settings?.terminalWindowsShell
  })
  const cmdOverrides = store.settings?.agentCmdOverrides ?? {}
  const effectiveAgentArgs =
    agentArgs !== undefined
      ? agentArgs
      : resolveTuiAgentLaunchArgs(agent, store.settings?.agentDefaultArgs)
  // An id, never a credential — the host swaps this marker for the launching
  // member's real env at spawn (src/main/codev-member-agent-env.ts).
  const agentEnv = {
    ...resolveTuiAgentLaunchEnv(agent, store.settings?.agentDefaultEnv),
    ...(typeof window !== 'undefined' && window.__CODEV_MEMBER_ID__
      ? { CODEV_AGENT_MEMBER: window.__CODEV_MEMBER_ID__ }
      : {})
  }
  const startupPlanBase = {
    agent,
    cmdOverrides,
    platform: resolvedLaunchPlatform,
    shell: queuedShell,
    isRemote,
    agentArgs: effectiveAgentArgs,
    agentEnv,
    sessionOptions: resolveNativeChatSessionOptionDefaults(
      store.settings?.nativeChatSessionOptions,
      agent
    )
  }
  const trimmedPrompt = prompt?.trim() ?? ''
  const hasPrompt = trimmedPrompt.length > 0
  const isFollowupPath = TUI_AGENT_CONFIG[agent].promptInjectionMode === 'stdin-after-start'
  const { startupPlan, pasteDraftAfterLaunch, submitPastedPrompt } = planLaunchAgentStartupPrompt({
    base: startupPlanBase,
    prompt: trimmedPrompt,
    promptDelivery,
    isFollowupPath
  })
  return {
    resolvedLaunchPlatform,
    isRemote,
    startupPlanBase,
    startupPlan,
    pasteDraftAfterLaunch,
    submitPastedPrompt,
    hasPrompt,
    trimmedPrompt,
    effectiveAgentArgs,
    isFollowupPath
  }
}
