import { useAppStore } from '@/store'

/** Opens in-workspace Settings on AI Provider Accounts → Coding workspaces. */
export function openCodevWorkspaceProviderSettings(): void {
  const { openSettingsPage, openSettingsTarget } = useAppStore.getState()
  openSettingsTarget({ pane: 'accounts', repoId: null, sectionId: 'coding-workspaces' })
  openSettingsPage()
}
