import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevProviderConnectionsView } from './CodevProviderConnectionsSection'

const disconnectedSnapshot = {
  viewer: { id: 'user-1', name: 'CoDev Test Jordan' },
  connections: [
    {
      provider: 'openai' as const,
      label: 'OpenAI',
      status: 'not_connected' as const,
      credentialType: null,
      lastFour: null,
      suppliedBy: null,
      scope: 'personal' as const
    },
    {
      provider: 'anthropic' as const,
      label: 'Anthropic',
      status: 'not_connected' as const,
      credentialType: null,
      lastFour: null,
      suppliedBy: null,
      scope: 'personal' as const
    }
  ],
  cliSubscriptions: [
    {
      provider: 'codex' as const,
      label: 'Codex',
      status: 'connected' as const,
      command: 'codev codex-auth'
    },
    {
      provider: 'claude' as const,
      label: 'Claude Code',
      status: 'not_connected' as const,
      command: 'codev claude-auth'
    }
  ]
}

describe('CodevProviderConnectionsView', () => {
  it('shows connected status with last four digits and a revoke control, never the secret', () => {
    const html = renderToStaticMarkup(
      <CodevProviderConnectionsView
        connected
        snapshot={{
          viewer: { id: 'user-1', name: 'CoDev Test Jordan' },
          connections: [
            {
              provider: 'openai',
              label: 'OpenAI',
              status: 'connected',
              credentialType: 'API_KEY',
              lastFour: '9kQ2',
              suppliedBy: 'CoDev Test Jordan',
              scope: 'personal'
            },
            {
              provider: 'anthropic',
              label: 'Anthropic',
              status: 'not_connected',
              credentialType: null,
              lastFour: null,
              suppliedBy: null,
              scope: 'personal'
            }
          ]
        }}
      />
    )
    expect(html).toContain('Provider connections')
    expect(html).toContain('OpenAI')
    expect(html).toContain('Connected · API key · supplied by CoDev Test Jordan · ending 9kQ2')
    expect(html).toContain('Replace key')
    expect(html).toContain('Revoke')
    expect(html).toContain('Anthropic')
    expect(html).toContain('Not connected')
    expect(html).toContain('Save key')
    expect(html).not.toContain('sk-')
    expect(html).not.toContain('ciphertext')
    expect(html).not.toContain('9kQ2secret')
    expect(html).not.toContain('Official OAuth')
  })

  it('shows a save control for a disconnected provider and an error without echoing the key', () => {
    const html = renderToStaticMarkup(
      <CodevProviderConnectionsView
        connected
        snapshot={disconnectedSnapshot}
        message="Enter a valid OpenAI API key."
      />
    )
    expect(html).toContain('Save key')
    expect(html).toContain('Enter a valid OpenAI API key.')
    expect(html).not.toContain('Revoke')
    expect(html).not.toContain('sk-test-codev-f62-fixture-key0001')
  })

  it('shows CLI subscription status inline on each provider card, with an API key alternative', () => {
    const html = renderToStaticMarkup(
      <CodevProviderConnectionsView connected snapshot={disconnectedSnapshot} />
    )
    expect(html).toContain('Codex CLI:')
    expect(html).toContain('Connected')
    expect(html).toContain('Claude Code CLI:')
    expect(html).toContain('Not connected · run')
    expect(html).toContain('codev claude-auth')
    expect(html).toContain('or paste an API key below instead')
    expect(html).not.toContain('Official OAuth')
    expect(html).not.toContain('fixture')
  })

  it('never renders the fixture OAuth flow', () => {
    const html = renderToStaticMarkup(
      <CodevProviderConnectionsView connected snapshot={disconnectedSnapshot} />
    )
    expect(html).not.toContain('Connect with OpenAI')
    expect(html).not.toContain('auth.openai.com')
    expect(html).not.toContain('sk-')
  })
})
