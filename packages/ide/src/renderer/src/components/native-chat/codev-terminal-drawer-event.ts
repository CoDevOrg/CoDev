export const CODEV_OPEN_TERMINAL_DRAWER_EVENT = 'codev:open-terminal-drawer'

export type CodevTerminalDrawerRequest = {
  worktreeId: string
  terminalTabId?: string | null
}

/** Request the active branch's chat to reveal its own bottom terminal drawer. */
export function requestCodevTerminalDrawerOpen(
  worktreeId: string,
  terminalTabId?: string | null
): void {
  if (typeof window === 'undefined' || !worktreeId.trim()) {
    return
  }
  window.dispatchEvent(
    new CustomEvent<CodevTerminalDrawerRequest>(CODEV_OPEN_TERMINAL_DRAWER_EVENT, {
      detail: {
        worktreeId,
        ...(terminalTabId ? { terminalTabId } : {})
      }
    })
  )
}
