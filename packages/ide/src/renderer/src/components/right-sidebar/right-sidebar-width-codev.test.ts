import { describe, expect, it } from 'vitest'
import {
  RIGHT_SIDEBAR_MIN_WIDTH,
  computeCodevMaxRightSidebarPanelWidth
} from './right-sidebar-width'

describe('computeCodevMaxRightSidebarPanelWidth', () => {
  it('keeps the panel no wider than the chat column beside it', () => {
    // 945px window, 330px left rail: 615px to share, so at most half.
    expect(computeCodevMaxRightSidebarPanelWidth(945, 0, 330)).toBe(307)
  })

  it('never goes below the minimum panel width', () => {
    expect(computeCodevMaxRightSidebarPanelWidth(600, 0, 330)).toBe(RIGHT_SIDEBAR_MIN_WIDTH)
  })

  it('counts the side activity bar as occupied width', () => {
    expect(computeCodevMaxRightSidebarPanelWidth(1400, 40, 280)).toBe(540)
  })

  it('falls back to the stock limit before the window is measured', () => {
    expect(computeCodevMaxRightSidebarPanelWidth(null, 0, 280)).toBe(2000)
  })
})
