export type CodevProviderConnectionProvider = 'openai' | 'anthropic' | 'cursor'
export type CodevCliSubscriptionProvider = 'codex' | 'claude' | 'cursor'
export type CodevProviderSurface = 'rooms' | 'workspace'
export type CodevCredentialProvenance = 'browser' | 'cli' | 'api_key'

export type CodevProviderSurfaceFlags = {
  enabledForRooms: boolean
  enabledForWorkspace: boolean
}

export type CodevProviderConnectionRecord = CodevProviderSurfaceFlags & {
  provider: CodevProviderConnectionProvider
  label: string
  status: 'connected' | 'not_connected'
  credentialType: 'API_KEY' | 'OAUTH_TOKEN' | null
  lastFour: string | null
  suppliedBy: string | null
  scope: 'personal'
  provenance: CodevCredentialProvenance | null
}

export type CodevCliSubscriptionRecord = CodevProviderSurfaceFlags & {
  provider: CodevCliSubscriptionProvider
  label: string
  status: 'connected' | 'not_connected'
  connectMode: 'app_callback' | 'manual_code' | 'device_code' | 'cursor_deeplink'
  command: string | null
  provenance: Exclude<CodevCredentialProvenance, 'api_key'> | null
}

export type CodevClaudeCliTokenRecord = CodevProviderSurfaceFlags & {
  status: 'connected' | 'not_connected'
  lastFour: string | null
}

export type CodevProviderConnectionSnapshot = {
  viewer: { id: string; name: string }
  connections: CodevProviderConnectionRecord[]
  cliSubscriptions: CodevCliSubscriptionRecord[]
  claudeCliToken: CodevClaudeCliTokenRecord
  hostedClaudeConnect: boolean
  hostedOpenAIConnect?: boolean
}

export type CodevSurfaceReadiness = {
  ready: boolean
  via: CodevCredentialProvenance[]
  source?: 'personal' | 'shared'
}

export type CodevProviderSurfaceCapability = Record<CodevProviderSurface, CodevSurfaceReadiness>

export const CODEV_PROVIDER_ACCOUNTS_DESCRIPTION =
  'Connect the accounts your agents run on. Chat rooms and coding workspaces are set up separately; a connection made in one can be enabled for the other where the sign-in method allows. Everything is encrypted on the CoDev server and never shown again after you save it.'

export const CODEV_PROVIDER_SURFACE_TABS = [
  {
    id: 'chat-rooms',
    surface: 'rooms' as const,
    label: 'Chat rooms',
    description:
      'Sign in with your Claude, ChatGPT, or Cursor subscription right in the browser — no terminal needed — or connect from your own terminal with the CoDev CLI.'
  },
  {
    id: 'coding-workspaces',
    surface: 'workspace' as const,
    label: 'Coding workspaces',
    description:
      'Workspaces run on a shared host, so a browser sign-in never reaches them. Connect with an API key, or sign in from your own terminal with the CoDev CLI.'
  }
] as const
