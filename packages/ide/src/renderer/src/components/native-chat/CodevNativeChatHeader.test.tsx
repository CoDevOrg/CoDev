// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CodevNativeChatHeader } from './CodevNativeChatHeader'

describe('CodevNativeChatHeader', () => {
  it('presents session status and routes the beginner-facing utilities', () => {
    const onToggleTerminal = vi.fn()
    const onOpenChanges = vi.fn()
    const onOpenBrowser = vi.fn()
    render(
      <TooltipProvider>
        <CodevNativeChatHeader
          agent="codex"
          working
          terminalOpen={false}
          onToggleTerminal={onToggleTerminal}
          onOpenChanges={onOpenChanges}
          onOpenBrowser={onOpenBrowser}
        />
      </TooltipProvider>
    )

    expect(screen.getByText('Codex session')).toBeInTheDocument()
    expect(screen.getByText('Working')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Changes' }))
    fireEvent.click(screen.getByLabelText('More workspace tools'))
    fireEvent.click(screen.getByRole('button', { name: 'Browser' }))
    expect(onToggleTerminal).toHaveBeenCalledOnce()
    expect(onOpenChanges).toHaveBeenCalledOnce()
    expect(onOpenBrowser).toHaveBeenCalledOnce()
  })
})
