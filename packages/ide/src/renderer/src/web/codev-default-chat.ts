import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { useAppStore, type AppState } from '@/store'
import type { TuiAgent } from '../../../shared/types'
import { isCodevEmbedded } from './codev-embedded'
import { codevChatTabIdInState } from './codev-center-chat-tab'
import { clearCodevAgentLaunching, markCodevAgentLaunching } from './codev-agent-launch-state'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { isWebRuntimeSessionActive } from '@/runtime/web-runtime-session'
import { getLastKnownHostTerminalTabCount } from '@/runtime/web-session-tabs-sync'

const CODEV_DEFAULT_AGENT: TuiAgent = 'claude'
const CHAT_TAB_WAIT_INTERVAL_MS = 500
const CHAT_TAB_WAIT_ATTEMPTS = 120

function waitForChatTab(worktreeId: string): Promise<boolean> {
  return new Promise((resolve) => {
    let attempts = 0
    const check = (): void => {
      if (codevChatTabIdInState(worktreeId, useAppStore.getState())) {
        resolve(true)
        return
      }
      attempts += 1
      if (attempts >= CHAT_TAB_WAIT_ATTEMPTS) {
        resolve(false)
        return
      }
      window.setTimeout(check, CHAT_TAB_WAIT_INTERVAL_MS)
    }
    check()
  })
}

async function waitForExistingHostTabs(worktreeId: string): Promise<void> {
  const state = useAppStore.getState()
  const environmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  if (
    !environmentId ||
    !isWebRuntimeSessionActive(environmentId) ||
    getLastKnownHostTerminalTabCount(environmentId, worktreeId) === 0
  ) {
    return
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = useAppStore.getState()
    if (
      (current.tabsByWorktree[worktreeId] ?? []).length > 0 ||
      codevChatTabIdInState(worktreeId, current)
    ) {
      return
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250))
  }
}

/** The provider shown in the workspace URL wins; Claude is the safe fallback. */
export function codevDefaultChatAgent(): TuiAgent {
  const requested = typeof window !== 'undefined' ? window.__CODEV_DEFAULT_AGENT__ : undefined
  return requested === 'codex' ? 'codex' : requested === 'claude' ? 'claude' : CODEV_DEFAULT_AGENT
}

function frontChatTab(worktreeId: string, state: AppState): boolean {
  const tabId = codevChatTabIdInState(worktreeId, state)
  if (!tabId) {
    return false
  }
  state.setActiveTabForWorktree(worktreeId, tabId)
  if (state.activeWorktreeId === worktreeId) {
    state.setActiveTab(tabId)
  }
  return true
}

/**
 * Ensure the workspace has one native chat surface. The promise resolves only
 * after the paired host mirrors the new tab, so the caller can keep the raw
 * workbench covered until chat is genuinely available.
 */
export async function ensureCodevDefaultChat(worktreeId: string): Promise<boolean> {
  if (!isCodevEmbedded()) {
    return false
  }

  const state = useAppStore.getState()
  if (frontChatTab(worktreeId, state)) {
    return true
  }

  markCodevAgentLaunching(worktreeId)
  try {
    // On a reload the host can know about an old conversation before its tab
    // snapshot reaches this client. Let that mirror land before deciding that
    // a fresh launch is needed, otherwise every reload can duplicate a chat.
    await waitForExistingHostTabs(worktreeId)
    const current = useAppStore.getState()
    if (frontChatTab(worktreeId, current)) {
      return true
    }
    const launch = launchAgentInNewTab({
      agent: codevDefaultChatAgent(),
      worktreeId,
      launchSource: 'new_workspace_composer'
    })
    if (!launch) {
      return false
    }
    return await waitForChatTab(worktreeId)
  } finally {
    clearCodevAgentLaunching(worktreeId)
  }
}
