import { tuiAgentToAgentKind } from '../../../shared/agent-kind'
import { isNativeChatSupportedAgent } from '@/lib/native-chat-supported-agent'
import { initialAgentTabViewModeProps } from '@/lib/native-chat-initial-view-mode'
import { isNativeChatTranscriptLocalReadable } from '@/lib/native-chat-transcript-readability'
import { getConnectionIdFromState } from '@/lib/connection-context'
import { runQuickCommandInNewTab } from '@/lib/run-quick-command-in-new-tab'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../shared/types'
import type { CodevBridgeCommand } from './codev-bridge'

/**
 * Runs a command the parent sent over the CoDev bridge. `terminal-run` opens
 * a fresh terminal tab in the workspace's active worktree and queues the
 * command as its startup text, the same primitive a stored quick command
 * uses to run in a new tab. No agent/session-option composition is involved,
 * so exactly the text the parent sent is what runs.
 *
 * When `command.agent` names a native-chat-supported agent (e.g. a Codex
 * resume), the tab opens tagged with that launch agent and in chat view
 * instead of a plain terminal — CoDev never wants to hand the member a raw
 * TUI for an agent chat can render, even though `command` here is a
 * resume/continue invocation rather than that agent's normal launch command.
 */
export function runCodevBridgeCommand(command: CodevBridgeCommand): void {
  if (command.kind !== 'terminal-run') {
    return
  }
  const state = useAppStore.getState()
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    return
  }
  if (isNativeChatSupportedAgent(command.agent)) {
    runAgentTaggedBridgeCommand(command, command.agent as TuiAgent, worktreeId)
    return
  }
  runQuickCommandInNewTab({
    command: {
      id: `codev-bridge-${Date.now()}`,
      label: command.label ?? 'CoDev',
      action: 'terminal-command',
      command: command.command,
      appendEnter: true
    },
    worktreeId
  })
}

function runAgentTaggedBridgeCommand(
  command: CodevBridgeCommand,
  agent: TuiAgent,
  worktreeId: string
): void {
  const store = useAppStore.getState()
  const viewModeProps = initialAgentTabViewModeProps(store.settings, {
    agent,
    nativeChatTranscriptIsLocalReadable: isNativeChatTranscriptLocalReadable(
      getConnectionIdFromState(store, worktreeId)
    )
  })
  const tab = store.createTab(worktreeId, undefined, undefined, {
    launchAgent: agent,
    quickCommandLabel: command.label ?? 'CoDev',
    ...viewModeProps
  })
  store.queueTabStartupCommand(tab.id, {
    command: command.command,
    launchAgent: agent,
    telemetry: {
      agent_kind: tuiAgentToAgentKind(agent),
      launch_source: 'unknown',
      request_kind: 'resume'
    }
  })
}
