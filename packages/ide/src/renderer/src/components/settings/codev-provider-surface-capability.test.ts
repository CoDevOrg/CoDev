import { describe, expect, it } from 'vitest'
import type { CodevProviderConnectionSnapshot } from './codev-provider-connection-types'
import { codevWorkspaceReadyAgent } from './codev-provider-surface-capability'

const empty: CodevProviderConnectionSnapshot = {
  viewer: { id: 'user-1', name: 'You' },
  connections: [
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
      provider: 'claude',
      label: 'Claude Code',
      status: 'not_connected',
      connectMode: 'manual_code',
      command: null,
      provenance: null,
      enabledForRooms: false,
      enabledForWorkspace: false
    },
    {
      provider: 'codex',
      label: 'Codex',
      status: 'not_connected',
      connectMode: 'device_code',
      command: null,
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

describe('codevWorkspaceReadyAgent', () => {
  it('is unset until a workspace-capable Claude or Codex login exists', () => {
    expect(codevWorkspaceReadyAgent(empty)).toBeNull()
  })

  it('prefers Claude when both can run', () => {
    const snapshot: CodevProviderConnectionSnapshot = {
      ...empty,
      connections: empty.connections.map((row) =>
        row.provider === 'anthropic' || row.provider === 'openai'
          ? {
              ...row,
              status: 'connected',
              credentialType: 'API_KEY',
              lastFour: 'abcd',
              provenance: 'api_key',
              enabledForWorkspace: true
            }
          : row
      )
    }
    expect(codevWorkspaceReadyAgent(snapshot)).toBe('claude')
  })

  it('selects Codex when only it can run on the host', () => {
    const snapshot: CodevProviderConnectionSnapshot = {
      ...empty,
      connections: empty.connections.map((row) =>
        row.provider === 'openai'
          ? {
              ...row,
              status: 'connected',
              credentialType: 'API_KEY',
              lastFour: 'abcd',
              provenance: 'api_key',
              enabledForWorkspace: true
            }
          : row
      )
    }
    expect(codevWorkspaceReadyAgent(snapshot)).toBe('codex')
  })

  it('ignores a rooms-only Claude browser subscription', () => {
    const snapshot: CodevProviderConnectionSnapshot = {
      ...empty,
      cliSubscriptions: empty.cliSubscriptions.map((row) =>
        row.provider === 'claude'
          ? {
              ...row,
              status: 'connected',
              provenance: 'browser',
              enabledForRooms: true,
              enabledForWorkspace: false
            }
          : row
      )
    }
    expect(codevWorkspaceReadyAgent(snapshot)).toBeNull()
  })
})
