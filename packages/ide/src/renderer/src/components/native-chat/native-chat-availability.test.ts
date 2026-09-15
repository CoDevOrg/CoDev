import { describe, it, expect } from 'vitest'
import { canToggleNativeChat } from './native-chat-availability'
import { } from '@/lib/native-chat-transcript-readability'

describe('canToggleNativeChat', () => {
  it('allows a terminal launched with a supported coding agent', () => {
    expect(
      canToggleNativeChat({
        experimentalNativeChatEnabled: true,
        contentType: 'terminal',
        launchAgent: 'claude'
      })
    ).toBe(true)
  })

  it('allows a terminal with a live detected supported agent but no launchAgent', () => {
    expect(
      canToggleNativeChat({
        experimentalNativeChatEnabled: true,
        contentType: 'terminal',
        launchAgent: null,
        detectedAgent: 'codex'
      })
    ).toBe(true)
  })

  it('allows a terminal with a resolved title/foreground supported agent before hooks arrive', () => {
    expect(
      canToggleNativeChat({
        experimentalNativeChatEnabled: true,
        contentType: 'terminal',
        launchAgent: null,
        resolvedAgent: 'claude'
      })
    ).toBe(true)
  })

  it('allows an existing chat view to toggle back after live signals are gone', () => {
    expect(
      canToggleNativeChat({
        experimentalNativeChatEnabled: true,
        contentType: 'terminal',
        launchAgent: null,
        isChatViewMode: true
      })
    ).toBe(true)
  })

  it('rejects an unsupported agent detected live (Gemini)', () => {
    expect(
      canToggleNativeChat({
        experimentalNativeChatEnabled: true,
        contentType: 'terminal',
        launchAgent: null,
        detectedAgent: 'gemini'
      })
    ).toBe(false)
  })

  it('rejects a stale supported title when live detection found an unsupported agent', () => {
    expect(
      canToggleNativeChat({
        experimentalNativeChatEnabled: true,
        contentType: 'terminal',
        launchAgent: null,
        detectedAgent: 'gemini',
        resolvedAgent: 'codex'
      })
    ).toBe(false)
  })

  it('rejects stale launch metadata when live detection found an unsupported agent', () => {
    expect(
      canToggleNativeChat({
        experimentalNativeChatEnabled: true,
        contentType: 'terminal',
        launchAgent: 'codex',
        detectedAgent: 'gemini'
      })
    ).toBe(false)
  })

  it('rejects otherwise eligible terminals while the experimental flag is off', () => {
    expect(
      canToggleNativeChat({
        experimentalNativeChatEnabled: false,
        contentType: 'terminal',
        launchAgent: 'claude'
      })
    ).toBe(false)
  })

  it('rejects a plain shell terminal with no agent', () => {
    expect(
      canToggleNativeChat({
        experimentalNativeChatEnabled: true,
        contentType: 'terminal',
        launchAgent: null,
        detectedAgent: null
      })
    ).toBe(false)
  })

  it('rejects a plain shell terminal with everything omitted', () => {
    expect(
      canToggleNativeChat({ experimentalNativeChatEnabled: true, contentType: 'terminal' })
    ).toBe(false)
  })

  it('rejects an editor tab even if a supported agent hint were somehow present', () => {
    expect(
      canToggleNativeChat({
        experimentalNativeChatEnabled: true,
        contentType: 'editor',
        launchAgent: 'codex',
        detectedAgent: 'codex'
      })
    ).toBe(false)
  })

  it('rejects a browser tab', () => {
    expect(
      canToggleNativeChat({
        experimentalNativeChatEnabled: true,
        contentType: 'browser',
        detectedAgent: 'claude'
      })
    ).toBe(false)
  })

  it('never offers the toggle inside CoDev, even for an otherwise-eligible tab', () => {
    expect(
      canToggleNativeChat(
        {
          experimentalNativeChatEnabled: true,
          contentType: 'terminal',
          launchAgent: 'claude'
        },
        { __CODEV_EMBEDDED__: true }
      )
    ).toBe(false)
  })

  it('never lets a CoDev chat tab toggle back to terminal either', () => {
    // Why: outside CoDev this exact input is allowed (see "allows an existing
    // chat view to toggle back" above) — CoDev must still refuse it.
    expect(
      canToggleNativeChat(
        {
          experimentalNativeChatEnabled: true,
          contentType: 'terminal',
          launchAgent: null,
          isChatViewMode: true
        },
        { __CODEV_EMBEDDED__: true }
      )
    ).toBe(false)
  })
})
