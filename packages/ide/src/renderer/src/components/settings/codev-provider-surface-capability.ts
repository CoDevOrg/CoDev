import type {
  CodevCredentialProvenance,
  CodevProviderConnectionProvider,
  CodevProviderConnectionSnapshot,
  CodevProviderSurfaceCapability,
  CodevSurfaceReadiness
} from './codev-provider-connection-types'

const ROOMS_ACCEPT_API_KEY = false

const SUBSCRIPTION_FOR: Record<CodevProviderConnectionProvider, 'codex' | 'claude' | 'cursor'> = {
  openai: 'codex',
  anthropic: 'claude',
  cursor: 'cursor'
}

function readiness(via: CodevCredentialProvenance[]): CodevSurfaceReadiness {
  return { ready: via.length > 0, via }
}

export function codevProviderSurfaceCapability(
  snapshot: CodevProviderConnectionSnapshot,
  provider: CodevProviderConnectionProvider
): CodevProviderSurfaceCapability {
  const apiKey = snapshot.connections.find((row) => row.provider === provider)
  const subscription = snapshot.cliSubscriptions.find(
    (row) => row.provider === SUBSCRIPTION_FOR[provider]
  )
  const keyConnected = apiKey?.status === 'connected'
  const subConnected = subscription?.status === 'connected'
  const claudeCli =
    provider === 'anthropic' && snapshot.claudeCliToken.status === 'connected'
      ? snapshot.claudeCliToken
      : null

  const rooms: CodevCredentialProvenance[] = []
  if (subConnected && subscription.enabledForRooms && subscription.provenance) {
    rooms.push(subscription.provenance)
  }
  if (claudeCli?.enabledForRooms) {
    rooms.push('cli')
  }
  if (ROOMS_ACCEPT_API_KEY && keyConnected && apiKey.enabledForRooms) {
    rooms.push('api_key')
  }

  const workspace: CodevCredentialProvenance[] = []
  if (keyConnected && apiKey.enabledForWorkspace) {
    workspace.push('api_key')
  }
  if (
    subConnected &&
    subscription.enabledForWorkspace &&
    (subscription.provenance === 'cli' || provider === 'openai')
  ) {
    workspace.push(subscription.provenance ?? 'cli')
  }
  if (claudeCli?.enabledForWorkspace) {
    workspace.push('cli')
  }

  return {
    rooms: readiness([...new Set(rooms)]),
    workspace: readiness([...new Set(workspace)])
  }
}

/** The agent a coding workspace can actually start, Claude first. Cursor can
 *  be connected here but does not unblock the default chat tab. */
export function codevWorkspaceReadyAgent(
  snapshot: CodevProviderConnectionSnapshot
): 'claude' | 'codex' | null {
  if (codevProviderSurfaceCapability(snapshot, 'anthropic').workspace.ready) {
    return 'claude'
  }
  if (codevProviderSurfaceCapability(snapshot, 'openai').workspace.ready) {
    return 'codex'
  }
  return null
}
