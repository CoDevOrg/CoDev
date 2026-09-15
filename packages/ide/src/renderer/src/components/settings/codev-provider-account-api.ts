import type { CodevProviderConnectionSnapshot } from './codev-provider-connection-types'

const RETURN_TO = '/settings/personal/providers'

type JsonPayload = Record<string, unknown>

async function readJson(response: Response): Promise<JsonPayload> {
  return (await response.json().catch(() => ({}))) as JsonPayload
}

export async function loadCodevProviderSnapshot(): Promise<CodevProviderConnectionSnapshot> {
  const response = await fetch('/api/personal/connections', {
    cache: 'no-store',
    credentials: 'include'
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'CoDev could not load provider connections.'
    )
  }
  return payload as unknown as CodevProviderConnectionSnapshot
}

export async function putCodevProviderApiKey(input: {
  provider: string
  apiKey: string
  surface?: string
}): Promise<CodevProviderConnectionSnapshot> {
  const response = await fetch('/api/personal/connections', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : 'The key could not be saved.'
    )
  }
  return payload as unknown as CodevProviderConnectionSnapshot
}

export async function patchCodevProviderSurface(input: {
  provider: string
  kind: 'api_key' | 'subscription' | 'claude_cli_token'
  surface: string
  enabled: boolean
}): Promise<CodevProviderConnectionSnapshot> {
  const response = await fetch('/api/personal/connections', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : 'The setting could not be saved.'
    )
  }
  return payload as unknown as CodevProviderConnectionSnapshot
}

export async function revokeCodevProviderConnection(input: {
  provider: string
  kind?: 'api_key' | 'claude_cli_token'
}): Promise<CodevProviderConnectionSnapshot> {
  const params = new URLSearchParams({ provider: input.provider })
  if (input.kind) {
    params.set('kind', input.kind)
  }
  const response = await fetch(`/api/personal/connections?${params.toString()}`, {
    method: 'DELETE',
    credentials: 'include'
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : 'The key could not be revoked.'
    )
  }
  return payload as unknown as CodevProviderConnectionSnapshot
}

export async function revokeCodevProviderSubscription(
  provider: string
): Promise<CodevProviderConnectionSnapshot> {
  const response = await fetch(`/api/personal/subscriptions?provider=${provider}`, {
    method: 'DELETE',
    credentials: 'include'
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : 'The account could not be disconnected.'
    )
  }
  return payload as unknown as CodevProviderConnectionSnapshot
}

export async function startCodevCursorConnect(): Promise<{ loginUrl: string }> {
  const response = await fetch('/api/auth/oauth/cursor/session', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scopeType: 'USER', returnTo: RETURN_TO })
  })
  const payload = await readJson(response)
  if (!response.ok || payload.mode !== 'cursor_deeplink' || typeof payload.loginUrl !== 'string') {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : 'Cursor sign-in could not start.'
    )
  }
  return { loginUrl: payload.loginUrl }
}

export async function pollCodevCursorConnect(): Promise<'connected' | 'denied' | 'pending'> {
  const response = await fetch('/api/auth/oauth/cursor/poll', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : 'Cursor sign-in failed. Start again.'
    )
  }
  if (payload.status === 'connected' || payload.status === 'denied') {
    return payload.status
  }
  return 'pending'
}

export async function completeCodevCursorApiKey(apiKey: string): Promise<void> {
  const response = await fetch('/api/auth/oauth/cursor/complete', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey, scopeType: 'USER' })
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : 'The Cursor API key was not accepted.'
    )
  }
}

export { RETURN_TO as CODEV_PROVIDER_OAUTH_RETURN_TO }
