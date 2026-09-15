import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevProviderConnectionsView } from './CodevProviderConnectionsSection'
import type { CodevProviderConnectionSnapshot } from './codev-provider-connection-types'

const disconnectedSnapshot: CodevProviderConnectionSnapshot = {
  viewer: { id: 'user-1', name: 'CoDev Test Jordan' },
  connections: [
    {
      provider: 'openai',
      label: 'OpenAI',
      status: 'not_connected',
      credentialType: null,
      lastFour: null,
      suppliedBy: null,
      scope: 'personal',
      provenance: null,
      enabledForRooms: false,
      enabledForWorkspace: false
    },
    {
      provider: 'anthropic',
      label: 'Anthropic',
      status: 'not_connected',
      credentialType: null,
      lastFour: null,
      suppliedBy: null,
      scope: 'personal',
      provenance: null,
      enabledForRooms: false,
      enabledForWorkspace: false
    },
    {
      provider: 'cursor',
      label: 'Cursor',
      status: 'not_connected',
      credentialType: null,
      lastFour: null,
      suppliedBy: null,
      scope: 'personal',
      provenance: null,
      enabledForRooms: false,
      enabledForWorkspace: false
    }
  ],
  cliSubscriptions: [
    {
      provider: 'codex',
      label: 'Codex',
      status: 'not_connected',
      connectMode: 'device_code',
      command: 'codev codex-auth',
      provenance: null,
      enabledForRooms: false,
      enabledForWorkspace: false
    },
    {
      provider: 'claude',
      label: 'Claude Code',
      status: 'not_connected',
      connectMode: 'manual_code',
      command: 'codev claude-auth',
      provenance: null,
      enabledForRooms: false,
      enabledForWorkspace: false
    },
    {
      provider: 'cursor',
      label: 'Cursor',
      status: 'not_connected',
      connectMode: 'cursor_deeplink',
      command: null,
      provenance: null,
      enabledForRooms: false,
      enabledForWorkspace: false
    }
  ],
  claudeCliToken: {
    status: 'not_connected',
    lastFour: null,
    enabledForRooms: false,
    enabledForWorkspace: false
  },
  hostedClaudeConnect: false,
  hostedOpenAIConnect: false
}

describe('CodevProviderConnectionsView', () => {
  it('renders the home-page provider tabs and Claude, Codex, and Cursor cards', () => {
    const html = renderToStaticMarkup(
      <CodevProviderConnectionsView
        connected
        onSnapshot={() => {}}
        snapshot={disconnectedSnapshot}
      />
    )
    expect(html).toContain('Chat rooms')
    expect(html).toContain('Coding workspaces')
    expect(html).toContain('Claude')
    expect(html).toContain('Codex')
    expect(html).toContain('Cursor')
    expect(html).toContain('Connect Cursor')
    expect(html).toContain('Connect from a terminal')
    expect(html).not.toContain('Gemini')
    expect(html).not.toContain('MiniMax')
    expect(html).not.toContain('sk-')
    expect(html).not.toContain('Provider connections')
  })

  it('shows Connect Claude and Connect ChatGPT when those hosted flows are enabled', () => {
    const html = renderToStaticMarkup(
      <CodevProviderConnectionsView
        connected
        onSnapshot={() => {}}
        snapshot={{
          ...disconnectedSnapshot,
          hostedClaudeConnect: true,
          hostedOpenAIConnect: true
        }}
      />
    )
    expect(html).toContain('Connect Claude')
    expect(html).toContain('Connect ChatGPT')
  })

  it('does not offer an API key on the chat-rooms tab', () => {
    const html = renderToStaticMarkup(
      <CodevProviderConnectionsView
        connected
        onSnapshot={() => {}}
        snapshot={disconnectedSnapshot}
      />
    )
    expect(html).toContain('API key support for chat rooms is coming soon')
    expect(html).not.toContain('Paste API key')
  })

  it('never renders a secret from a connected API key', () => {
    const html = renderToStaticMarkup(
      <CodevProviderConnectionsView
        connected
        onSnapshot={() => {}}
        snapshot={{
          ...disconnectedSnapshot,
          connections: disconnectedSnapshot.connections.map((row) =>
            row.provider === 'openai'
              ? {
                  ...row,
                  status: 'connected',
                  credentialType: 'API_KEY',
                  lastFour: '9kQ2',
                  suppliedBy: 'CoDev Test Jordan',
                  provenance: 'api_key',
                  enabledForWorkspace: true
                }
              : row
          )
        }}
      />
    )
    expect(html).not.toContain('sk-')
    expect(html).not.toContain('ciphertext')
    expect(html).not.toContain('9kQ2secret')
  })

  it('opens on Coding workspaces when that tab was requested', () => {
    const html = renderToStaticMarkup(
      <CodevProviderConnectionsView
        connected
        initialTabId="coding-workspaces"
        onSnapshot={() => {}}
        snapshot={disconnectedSnapshot}
      />
    )
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('id="coding-workspaces-tab"')
    expect(html).toContain('Paste API key')
  })

  it('does not offer Cursor on the coding workspaces tab', () => {
    const html = renderToStaticMarkup(
      <CodevProviderConnectionsView
        connected
        initialTabId="coding-workspaces"
        onSnapshot={() => {}}
        snapshot={disconnectedSnapshot}
      />
    )
    expect(html).toContain('Claude')
    expect(html).toContain('Codex')
    expect(html).not.toContain('Cursor')
    expect(html).not.toContain('Connect Cursor')
  })
})
