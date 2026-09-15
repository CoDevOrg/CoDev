import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevFirstChatProviderSetupView } from './CodevFirstChatProviderSetup'

describe('CodevFirstChatProviderSetupView', () => {
  it('sends the member to in-workspace Settings instead of the home providers page', () => {
    const html = renderToStaticMarkup(
      <CodevFirstChatProviderSetupView onOpenSettings={() => {}} reason={null} />
    )
    expect(html).toContain('Connect an agent to start')
    expect(html).toContain('Connect one in Settings')
    expect(html).toContain('Open Settings')
    expect(html).not.toContain('/settings/personal/providers')
    expect(html).not.toContain('Chat rooms')
  })

  it('names a rooms-only gap when the parent supplied a reason', () => {
    const html = renderToStaticMarkup(
      <CodevFirstChatProviderSetupView
        onOpenSettings={() => {}}
        reason="Claude is connected for chat rooms only."
      />
    )
    expect(html).toContain('Claude is connected for chat rooms only.')
    expect(html).toContain('Open Settings')
  })
})
