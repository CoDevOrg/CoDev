// @vitest-environment happy-dom

import type { ReactNode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))

vi.mock('@/components/ui/tooltip', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>
  return {
    TooltipProvider: Passthrough,
    Tooltip: Passthrough,
    TooltipTrigger: Passthrough,
    TooltipContent: Passthrough
  }
})

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutLabel: () => '⌘N'
}))

vi.mock('./SidebarWorkspaceOptionsMenu', () => ({
  default: () => <div data-testid="workspace-options-menu" />
}))

import SidebarHeader from './SidebarHeader'

function setState(): void {
  mocks.state = { openModal: vi.fn(), groupBy: 'repo', repos: [] }
}

afterEach(() => {
  cleanup()
  delete (window as { __CODEV_EMBEDDED__?: boolean }).__CODEV_EMBEDDED__
})

describe('SidebarHeader', () => {
  it('renders the section title outside the CoDev-embedded client', () => {
    setState()
    const view = render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    expect(view.container.querySelector('[data-sidebar-section-title]')).not.toBeNull()
  })

  it('renders nothing in the CoDev-embedded client so the team rail owns the sidebar', () => {
    ;(window as { __CODEV_EMBEDDED__?: boolean }).__CODEV_EMBEDDED__ = true
    setState()
    const view = render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    expect(view.container.innerHTML).toBe('')
  })
})
