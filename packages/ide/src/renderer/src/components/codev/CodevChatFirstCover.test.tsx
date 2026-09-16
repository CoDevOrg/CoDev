// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodevChatFirstCover } from './CodevChatFirstCover'

afterEach(cleanup)

describe('CodevChatFirstCover', () => {
  it('keeps the raw terminal covered while the primary chat is launching', () => {
    render(<CodevChatFirstCover />)

    expect(screen.getByRole('status').getAttribute('data-codev-chat-first')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Opening your chat…' })).toBeTruthy()
    expect(screen.getByText(/terminal stays hidden/i)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers a retry when the primary chat cannot start', () => {
    const onRetry = vi.fn()
    render(<CodevChatFirstCover error="Connection lost" onRetry={onRetry} />)

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Chat could not start' })).toBeTruthy()
    expect(screen.getByText('Connection lost')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('explains where managed-agent conversations live without exposing a retry', () => {
    render(<CodevChatFirstCover managed />)

    expect(screen.getByRole('heading', { name: 'Managed agent workspace' })).toBeTruthy()
    expect(screen.getByText(/open Agents on the right/i)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
