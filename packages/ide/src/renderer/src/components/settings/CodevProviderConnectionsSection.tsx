import { useEffect, useState, type JSX } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge,
  type CodevBridgeSnapshot
} from '@/web/codev-bridge-singleton'

export type CodevProviderConnection = {
  provider: 'openai' | 'anthropic'
  label: string
  status: 'connected' | 'not_connected'
  credentialType: 'API_KEY' | 'OAUTH_TOKEN' | null
  lastFour: string | null
  suppliedBy: string | null
  scope: 'personal'
}

export type CodevCliSubscriptionProvider = 'codex' | 'claude'

export type CodevCliSubscription = {
  provider: CodevCliSubscriptionProvider
  label: string
  status: 'connected' | 'not_connected'
  command: string
}

export type CodevProviderConnectionSnapshot = {
  viewer: { id: string; name: string }
  connections: CodevProviderConnection[]
  cliSubscriptions?: CodevCliSubscription[]
}

export type CodevProviderConnectionDrafts = Partial<
  Record<CodevProviderConnection['provider'], string>
>

const CLI_PROVIDER_BY_CONNECTION: Record<
  CodevProviderConnection['provider'],
  CodevCliSubscriptionProvider
> = {
  openai: 'codex',
  anthropic: 'claude'
}

function statusLabel(connection: CodevProviderConnection): string {
  if (connection.status !== 'connected') return 'Not connected'
  const ending = connection.lastFour ? ` · ending ${connection.lastFour}` : ''
  const owner = connection.suppliedBy ? ` · supplied by ${connection.suppliedBy}` : ''
  const kind = connection.credentialType === 'OAUTH_TOKEN' ? 'OAuth' : 'API key'
  return `Connected · ${kind}${owner}${ending}`
}

export function CodevProviderConnectionsView({
  connected,
  snapshot,
  drafts = {},
  busy = '',
  message = '',
  onDraftChange,
  onSave,
  onRevoke
}: {
  connected: boolean
  snapshot: CodevProviderConnectionSnapshot | null
  drafts?: CodevProviderConnectionDrafts
  busy?: string
  message?: string
  onDraftChange?: (provider: CodevProviderConnection['provider'], value: string) => void
  onSave?: (provider: CodevProviderConnection['provider']) => void
  onRevoke?: (provider: CodevProviderConnection['provider']) => void
}): JSX.Element {
  const cliSubscriptions = snapshot?.cliSubscriptions ?? []
  return (
    <div
      id="codev-provider-connections"
      className="scroll-mt-6 space-y-3"
      data-codev-provider-connections="true"
    >
      <SettingsSubsectionHeader
        title="Provider connections"
        description="Sign in with the official CoDev CLI, or paste a personal OpenAI or Anthropic API key instead. Keys stay encrypted on the CoDev server and are never shown after you save them."
      />
      {!connected ? (
        <p className="text-xs text-muted-foreground">Connect the CoDev bridge to manage provider connections.</p>
      ) : (
        <ul className="space-y-2" aria-label="Provider connection status">
          {(snapshot?.connections ?? []).map((connection) => {
            const saving = busy === `save:${connection.provider}`
            const revoking = busy === `revoke:${connection.provider}`
            const disabled = !connected || busy !== ''
            const cli = cliSubscriptions.find(
              (subscription) => subscription.provider === CLI_PROVIDER_BY_CONNECTION[connection.provider]
            )
            return (
              <li
                key={connection.provider}
                className="space-y-2 rounded-md border border-border p-3"
                aria-label={`${connection.label} connection`}
                data-codev-connection-status={connection.status}
              >
                <p className="text-sm font-medium">{connection.label}</p>
                <p className="text-xs text-muted-foreground">{statusLabel(connection)}</p>
                {cli ? (
                  <p className="text-xs text-muted-foreground" data-codev-cli-status={cli.status}>
                    {cli.label} CLI:{' '}
                    {cli.status === 'connected' ? (
                      'Connected'
                    ) : (
                      <>
                        Not connected · run <code>{cli.command}</code> · or paste an API key below instead
                      </>
                    )}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`codev-connection-key-${connection.provider}`}>
                    {connection.label} API key
                  </label>
                  <input
                    id={`codev-connection-key-${connection.provider}`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`${connection.label} API key`}
                    placeholder="Paste API key"
                    className="h-8 min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 text-xs"
                    value={drafts[connection.provider] ?? ''}
                    disabled={disabled}
                    onChange={(event) => onDraftChange?.(connection.provider, event.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onSave?.(connection.provider)}
                  >
                    {saving
                      ? 'Saving…'
                      : connection.status === 'connected'
                        ? 'Replace key'
                        : 'Save key'}
                  </Button>
                  {connection.status === 'connected' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => onRevoke?.(connection.provider)}
                    >
                      {revoking ? 'Revoking…' : 'Revoke'}
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {message ? (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}

export function CodevProviderConnectionsSection(): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
  const [bridge, setBridge] = useState<CodevBridgeSnapshot>(() => getCodevBridgeSnapshot())
  const [snapshot, setSnapshot] = useState<CodevProviderConnectionSnapshot | null>(null)
  const [drafts, setDrafts] = useState<CodevProviderConnectionDrafts>({})
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => subscribeCodevBridge(() => setBridge(getCodevBridgeSnapshot())), [])

  useEffect(() => {
    if (!embedded || bridge.status !== 'connected') return
    let cancelled = false
    void requestCodevBridge<CodevProviderConnectionSnapshot>('connections.list')
      .then((result) => {
        if (!cancelled) setSnapshot(result)
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null)
      })
    return () => {
      cancelled = true
    }
  }, [embedded, bridge.status])

  async function save(provider: CodevProviderConnection['provider']): Promise<void> {
    const apiKey = drafts[provider]?.trim() ?? ''
    setBusy(`save:${provider}`)
    setMessage('')
    try {
      const result = await requestCodevBridge<CodevProviderConnectionSnapshot>('connections.put', {
        provider,
        apiKey
      })
      setSnapshot(result)
      setDrafts((current) => ({ ...current, [provider]: '' }))
      setMessage(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} key saved.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The key could not be saved.')
    } finally {
      setBusy('')
    }
  }

  async function revoke(provider: CodevProviderConnection['provider']): Promise<void> {
    setBusy(`revoke:${provider}`)
    setMessage('')
    try {
      const result = await requestCodevBridge<CodevProviderConnectionSnapshot>(
        'connections.revoke',
        { provider }
      )
      setSnapshot(result)
      setDrafts((current) => ({ ...current, [provider]: '' }))
      setMessage(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} connection revoked.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The connection could not be revoked.')
    } finally {
      setBusy('')
    }
  }

  if (!embedded) return null

  return (
    <CodevProviderConnectionsView
      connected={bridge.status === 'connected'}
      snapshot={snapshot}
      drafts={drafts}
      busy={busy}
      message={message}
      onDraftChange={(provider, value) =>
        setDrafts((current) => ({ ...current, [provider]: value }))
      }
      onSave={(provider) => {
        void save(provider)
      }}
      onRevoke={(provider) => {
        void revoke(provider)
      }}
    />
  )
}
