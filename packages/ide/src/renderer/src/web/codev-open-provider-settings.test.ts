import { beforeEach, describe, expect, it, vi } from 'vitest'

const openSettingsPage = vi.fn()
const openSettingsTarget = vi.fn()

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ openSettingsPage, openSettingsTarget })
  }
}))

describe('openCodevWorkspaceProviderSettings', () => {
  beforeEach(() => {
    openSettingsPage.mockReset()
    openSettingsTarget.mockReset()
  })

  it('opens in-workspace AI Provider Accounts on Coding workspaces', async () => {
    const { openCodevWorkspaceProviderSettings } = await import('./codev-open-provider-settings')
    openCodevWorkspaceProviderSettings()
    expect(openSettingsTarget).toHaveBeenCalledWith({
      pane: 'accounts',
      repoId: null,
      sectionId: 'coding-workspaces'
    })
    expect(openSettingsPage).toHaveBeenCalledOnce()
    expect(openSettingsTarget.mock.invocationCallOrder[0]).toBeLessThan(
      openSettingsPage.mock.invocationCallOrder[0]!
    )
  })
})
