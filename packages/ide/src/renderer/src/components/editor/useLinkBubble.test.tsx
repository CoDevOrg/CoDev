// @vitest-environment happy-dom

import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HttpLinkSourceOwner } from '@/lib/http-link-routing'
import type { LinkBubbleState } from './RichMarkdownLinkBubble'
import { createRichMarkdownHtmlSuperscriptLinkContext } from './rich-markdown-html-superscript-link-context'

const activateMarkdownLinkMock = vi.hoisted(() => vi.fn())

vi.mock('@/store', () => ({
  useAppStore: (
    selector: (state: { activateMarkdownLink: typeof activateMarkdownLinkMock }) => unknown
  ) => selector({ activateMarkdownLink: activateMarkdownLinkMock })
}))

import { useLinkBubble } from './useLinkBubble'

describe('useLinkBubble owner hydration', () => {
  let container: HTMLDivElement
  let root: Root

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    activateMarkdownLinkMock.mockReset()
  })

})
