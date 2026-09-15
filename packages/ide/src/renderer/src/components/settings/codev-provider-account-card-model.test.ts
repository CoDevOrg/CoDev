import { describe, expect, it } from 'vitest'
import { deriveCodevProviderCardModel } from './codev-provider-account-card-model'
import type {
  CodevCliSubscriptionRecord,
  CodevProviderConnectionRecord
} from './codev-provider-connection-types'

const connection: CodevProviderConnectionRecord = {
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
}

const subscription: CodevCliSubscriptionRecord = {
  provider: 'claude',
  label: 'Claude Code',
  status: 'not_connected',
  connectMode: 'manual_code',
  command: 'codev claude-auth',
  provenance: null,
  enabledForRooms: false,
  enabledForWorkspace: false
}

describe('deriveCodevProviderCardModel', () => {
  it('hides the API key on chat rooms and the browser connect on coding workspaces', () => {
    const rooms = deriveCodevProviderCardModel({
      surface: 'rooms',
      subscription,
      connection,
      hostedClaudeConnect: true,
      hostedOpenAIConnect: false,
      connected: false
    })
    expect(rooms.offerApiKey).toBe(false)
    expect(rooms.offerBrowserConnect).toBe(true)
    expect(rooms.showClaudeConnect).toBe(true)

    const workspace = deriveCodevProviderCardModel({
      surface: 'workspace',
      subscription,
      connection,
      hostedClaudeConnect: true,
      hostedOpenAIConnect: false,
      connected: false
    })
    expect(workspace.offerApiKey).toBe(true)
    expect(workspace.offerBrowserConnect).toBe(false)
    expect(workspace.showClaudeConnect).toBe(false)
  })
})
