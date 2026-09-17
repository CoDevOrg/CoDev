// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = {
    rightSidebarOpen: false,
    rightSidebarTab: 'codev-agents' as 'codev-agents' | 'codev-branches',
    setRightSidebarTab: vi.fn(),
    setRightSidebarOpen: vi.fn()
  }
  state.setRightSidebarTab.mockImplementation((tab) => {
    state.rightSidebarTab = tab
  })
  state.setRightSidebarOpen.mockImplementation((open) => {
    state.rightSidebarOpen = open
  })
  return { state }
})

vi.mock('@/store', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
  return { useAppStore }
})

vi.mock('@/web/codev-embedded', () => ({
  isCodevEmbedded: () => true
}))

import { closeCodevBranches, openCodevBranches, toggleCodevBranches } from './codev-branches-view'

afterEach(() => {
  mocks.state.rightSidebarOpen = false
  mocks.state.rightSidebarTab = 'codev-agents'
  vi.clearAllMocks()
})

describe('CoDev Branches right-sidebar navigation', () => {
  it('opens Branches without covering the center workspace', () => {
    openCodevBranches()

    expect(mocks.state.setRightSidebarTab).toHaveBeenCalledWith('codev-branches')
    expect(mocks.state.setRightSidebarOpen).toHaveBeenCalledWith(true)
    expect(mocks.state.rightSidebarTab).toBe('codev-branches')
    expect(mocks.state.rightSidebarOpen).toBe(true)
  })

  it('returns to Agents while keeping the right sidebar open', () => {
    mocks.state.rightSidebarOpen = true
    mocks.state.rightSidebarTab = 'codev-branches'

    closeCodevBranches()

    expect(mocks.state.setRightSidebarTab).toHaveBeenCalledWith('codev-agents')
    expect(mocks.state.setRightSidebarOpen).not.toHaveBeenCalled()
    expect(mocks.state.rightSidebarOpen).toBe(true)
  })

  it('toggles between the Branches and Agents panels', () => {
    openCodevBranches()
    toggleCodevBranches()
    expect(mocks.state.rightSidebarTab).toBe('codev-agents')

    toggleCodevBranches()
    expect(mocks.state.rightSidebarTab).toBe('codev-branches')
    expect(mocks.state.rightSidebarOpen).toBe(true)
  })
})
