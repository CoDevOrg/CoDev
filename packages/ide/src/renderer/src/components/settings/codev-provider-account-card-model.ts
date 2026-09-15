import type {
  CodevCliSubscriptionRecord,
  CodevClaudeCliTokenRecord,
  CodevProviderConnectionRecord,
  CodevProviderSurface,
  CodevProviderSurfaceCapability
} from './codev-provider-connection-types'

export type CodevProviderCardModel = {
  roomsSurface: boolean
  workspaceSurface: boolean
  offerBrowserConnect: boolean
  offerApiKey: boolean
  showClaudeConnect: boolean
  showCodexConnect: boolean
  showHostedConnect: boolean
  isCursor: boolean
  cliTokenConnected: boolean
  workspaceLoginConnected: boolean
  surfaceReady: boolean | undefined
  headerStatus: string
}

export function deriveCodevProviderCardModel(input: {
  surface?: CodevProviderSurface
  subscription: CodevCliSubscriptionRecord
  connection: CodevProviderConnectionRecord
  hostedClaudeConnect: boolean
  hostedOpenAIConnect: boolean
  claudeCliToken?: CodevClaudeCliTokenRecord
  capability?: CodevProviderSurfaceCapability
  connected: boolean
}): CodevProviderCardModel {
  const roomsSurface = input.surface === 'rooms'
  const workspaceSurface = input.surface === 'workspace'
  const offerBrowserConnect = !workspaceSurface
  const offerApiKey = !roomsSurface
  const isCursor = input.subscription.provider === 'cursor'
  const showClaudeConnect =
    offerBrowserConnect && input.hostedClaudeConnect && input.subscription.provider === 'claude'
  const showCodexConnect =
    offerBrowserConnect && input.hostedOpenAIConnect && input.subscription.provider === 'codex'
  const showHostedConnect = showClaudeConnect || showCodexConnect
  const cliTokenConnected = input.claudeCliToken?.status === 'connected'
  const workspaceLoginConnected = workspaceSurface
    ? input.subscription.provider === 'claude'
      ? cliTokenConnected
      : input.subscription.provider === 'codex'
        ? input.connected && input.subscription.provenance === 'cli'
        : false
    : input.connected
  const surfaceReady = input.capability
    ? workspaceSurface
      ? input.capability.workspace.ready
      : input.capability.rooms.ready
    : undefined

  let headerStatus: string
  if (workspaceSurface) {
    headerStatus = surfaceReady
      ? 'Ready for coding workspaces'
      : 'Connect with an API key or from your terminal below'
  } else if (roomsSurface) {
    headerStatus = surfaceReady
      ? 'Ready for chat rooms'
      : isCursor || showHostedConnect
        ? 'Sign in with your subscription — no API key needed'
        : 'Connect from your terminal below'
  } else if (input.connected) {
    headerStatus = 'Signed in with your subscription'
  } else {
    headerStatus =
      isCursor || showHostedConnect
        ? 'Sign in with your subscription — no API key needed'
        : 'Connect with an API key or the CoDev CLI below'
  }

  return {
    roomsSurface,
    workspaceSurface,
    offerBrowserConnect,
    offerApiKey,
    showClaudeConnect,
    showCodexConnect,
    showHostedConnect,
    isCursor,
    cliTokenConnected,
    workspaceLoginConnected,
    surfaceReady,
    headerStatus
  }
}
