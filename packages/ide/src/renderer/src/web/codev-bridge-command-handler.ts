import { runQuickCommandInNewTab } from '@/lib/run-quick-command-in-new-tab'
import { useAppStore } from '@/store'
import type { CodevBridgeCommand } from './codev-bridge'

/**
 * Runs a command the parent sent over the CoDev bridge. `terminal-run` opens
 * a fresh plain terminal tab in the workspace's active worktree and queues
 * the command as its startup text, the same primitive a stored quick command
 * uses to run in a new tab. No agent/session-option composition is involved,
 * so exactly the text the parent sent is what runs.
 */
export function runCodevBridgeCommand(command: CodevBridgeCommand): void {
  if (command.kind !== 'terminal-run') {
    return
  }
  const worktreeId = useAppStore.getState().activeWorktreeId
  if (!worktreeId) {
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
