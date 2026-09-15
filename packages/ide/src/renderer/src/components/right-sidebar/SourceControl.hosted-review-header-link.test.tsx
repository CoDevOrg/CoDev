import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostedReviewInfo } from '../../../../shared/hosted-review'
import { HostedReviewHeaderLink } from './hosted-review-header-chrome'

const { openHttpLinkMock } = vi.hoisted(() => ({ openHttpLinkMock: vi.fn() }))

vi.mock('@/lib/http-link-routing', () => ({
  openHttpLink: openHttpLinkMock,
  registerHttpLinkStoreAccessor: vi.fn()
}))

function makeReview(overrides: Partial<HostedReviewInfo> = {}): HostedReviewInfo {
  return {
    provider: 'github',
    number: 2192,
    title: 'Open PR in checks',
    state: 'open',
    url: 'https://github.com/stablyai/orca/pull/2192',
    status: 'pending',
    updatedAt: '2026-05-17T00:00:00Z',
    mergeable: 'UNKNOWN',
    ...overrides
  }
}

type MinimalClickEvent = Pick<
  React.MouseEvent<HTMLButtonElement>,
  'nativeEvent' | 'stopPropagation'
>
type ClickModifiers = Partial<Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>>

function clickEvent(modifiers: ClickModifiers = {}): MinimalClickEvent {
  return {
    nativeEvent: {
      metaKey: modifiers.metaKey ?? false,
      ctrlKey: modifiers.ctrlKey ?? false,
      shiftKey: modifiers.shiftKey ?? false
    } as MouseEvent,
    stopPropagation: vi.fn()
  }
}

beforeEach(() => {
  openHttpLinkMock.mockReset()
})

describe('HostedReviewHeaderLink', () => {
  it('opens GitHub PRs in the Checks tab instead of rendering an external link', () => {
    const onOpenHostedReviewInChecks = vi.fn()
    const element = HostedReviewHeaderLink({
      review: makeReview(),
      onOpenHostedReviewInChecks
    })
    const markup = renderToStaticMarkup(element)

    expect(markup).toContain('<button')
    expect(markup).toContain('PR #2192')
    expect(markup).toContain('underline decoration-border underline-offset-2')
    expect(markup).not.toContain('href=')
    expect(markup).not.toContain('target="_blank"')
    expect(markup).not.toContain('system browser')
    expect(markup).not.toContain('⌘+click')

    const event = clickEvent()
    ;(element.props.onClick as (event: MinimalClickEvent) => void)(event)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    expect(onOpenHostedReviewInChecks).toHaveBeenCalledTimes(1)
    expect(openHttpLinkMock).not.toHaveBeenCalled()
  })

  it.each<[string, ClickModifiers]>([
    ['Cmd-click', { metaKey: true }],
    ['Ctrl-click', { ctrlKey: true }],
    ['Shift+Cmd-click', { metaKey: true, shiftKey: true }],
    ['Shift+Ctrl-click', { ctrlKey: true, shiftKey: true }]
  ])('opens GitHub PRs in the Checks tab on %s', (_label, modifiers) => {
    const onOpenHostedReviewInChecks = vi.fn()
    const element = HostedReviewHeaderLink({
      review: makeReview(),
      onOpenHostedReviewInChecks
    })

    const event = clickEvent(modifiers)
    ;(element.props.onClick as (event: MinimalClickEvent) => void)(event)

    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    expect(onOpenHostedReviewInChecks).toHaveBeenCalledTimes(1)
    expect(openHttpLinkMock).not.toHaveBeenCalled()
  })

})
