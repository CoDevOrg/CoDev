import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import type { TerminalTab } from '../../../../shared/types'

/**
 * The worktree's drawer shell: its one terminal tab that is not the agent's.
 *
 * CoDev retires stray stock shells and hides the tab strip, so an agent
 * worktree holds the agent's chat tab and — once opened — the drawer's shell,
 * nothing else. That makes "the non-agent terminal" an identity stable across
 * reloads and across members without any marker the host would have to persist.
 */
function findDrawerTab(
  tabs: TerminalTab[],
  unifiedTabs: { id?: string; entityId?: string; viewMode?: string }[]
): TerminalTab | null {
  // Why not `tab.launchAgent`: a paired host mirrors its tabs back with
  // launchAgent unset, so every tab — the agent's chat included — looks like a
  // plain shell. `viewMode` is the signal that survives the round trip.
  const chatTabIds = new Set<string>()
  for (const tab of unifiedTabs) {
    if (tab.viewMode !== 'chat') continue
    if (tab.id) chatTabIds.add(tab.id)
    if (tab.entityId) chatTabIds.add(tab.entityId)
  }
  return tabs.find((tab) => !chatTabIds.has(tab.id) && !tab.launchAgent) ?? null
}

/**
 * Resolve the pty backing the CoDev terminal drawer, creating the shell on
 * first open.
 *
 * The drawer is a plain shell in the worktree, deliberately *not* a view onto
 * the agent's own pty — opening it used to replay the agent's scrollback, so a
 * member asking for a terminal got Claude's running TUI instead of a prompt.
 *
 * The shell is created through the runtime session RPC rather than the store's
 * local `createTab`: on CoDev's paired host a client-side tab mints no pty at
 * all, so the drawer would mount an xterm onto nothing and sit there blank. Its
 * tab lives on the host, so one drawer shell is shared by the workspace's
 * members and survives reloads.
 */
export function useCodevDrawerTerminal({
  worktreeId,
  open
}: {
  worktreeId: string | null
  open: boolean
}): string | null {
  const tabs = useAppStore((state) => (worktreeId ? state.tabsByWorktree[worktreeId] : undefined))
  const unifiedTabs = useAppStore((state) =>
    worktreeId ? state.unifiedTabsByWorktree?.[worktreeId] : undefined
  )
  const drawerTab = tabs ? findDrawerTab(tabs, unifiedTabs ?? []) : null

  useEffect(() => {
    if (!open || !worktreeId || drawerTab) {
      return
    }
    let cancelled = false
    void (async () => {
      const state = useAppStore.getState()
      const environmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
      if (!environmentId) {
        // Unpaired (or not yet paired) — nothing can spawn the shell yet; the
        // next open retries.
        return
      }
      try {
        const { createWebRuntimeSessionTerminal } = await import('@/runtime/web-runtime-session')
        const created = await createWebRuntimeSessionTerminal({
          worktreeId,
          environmentId,
          // The drawer is a peek, not a navigation: activating would pull the
          // workspace off the chat that owns the screen.
          activate: false
        })
        if (!cancelled && created.status === 'failed') {
          console.warn('CoDev could not open the terminal drawer shell:', created.message)
        }
      } catch (error) {
        console.warn('CoDev could not open the terminal drawer shell:', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, worktreeId, drawerTab])

  return drawerTab?.ptyId ?? null
}
