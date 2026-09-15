import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  completeCodevCursorApiKey,
  patchCodevProviderSurface,
  pollCodevCursorConnect,
  putCodevProviderApiKey,
  revokeCodevProviderConnection,
  revokeCodevProviderSubscription,
  startCodevCursorConnect
} from './codev-provider-account-api'
import { CodevStatusDot } from './codev-provider-account-card-controls'
import { deriveCodevProviderCardModel } from './codev-provider-account-card-model'
import { CodevProviderAccountCardActions } from './CodevProviderAccountCardActions'
import { CodevProviderAccountCardMethods } from './CodevProviderAccountCardMethods'
import { CodevHostedClaudeConnect } from './CodevHostedClaudeConnect'
import { CodevHostedCodexConnect } from './CodevHostedCodexConnect'
import type {
  CodevCliSubscriptionRecord,
  CodevClaudeCliTokenRecord,
  CodevProviderConnectionRecord,
  CodevProviderConnectionSnapshot,
  CodevProviderSurface,
  CodevProviderSurfaceCapability
} from './codev-provider-connection-types'

type ActiveFlow = { kind: 'polling'; loginUrl: string }

export function CodevProviderAccountCard({
  logo,
  label,
  subscription,
  connection,
  hostedClaudeConnect = false,
  hostedOpenAIConnect = false,
  surface,
  capability,
  claudeCliToken,
  onSnapshot
}: {
  logo: ReactNode
  label: string
  subscription: CodevCliSubscriptionRecord
  connection: CodevProviderConnectionRecord
  hostedClaudeConnect?: boolean
  hostedOpenAIConnect?: boolean
  surface?: CodevProviderSurface
  capability?: CodevProviderSurfaceCapability
  claudeCliToken?: CodevClaudeCliTokenRecord
  onSnapshot: (snapshot: CodevProviderConnectionSnapshot | null) => void
}): JSX.Element {
  const [apiKeyState, setApiKeyState] = useState(connection)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'save' | 'revoke' | ''>('')
  const [message, setMessage] = useState('')
  const [flow, setFlow] = useState<ActiveFlow | null>(null)
  const [connected, setConnected] = useState(subscription.status === 'connected')
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollStartedAt = useRef(0)
  const model = deriveCodevProviderCardModel({
    surface,
    subscription,
    connection,
    hostedClaudeConnect,
    hostedOpenAIConnect,
    claudeCliToken,
    capability,
    connected
  })
  const disabled = busy !== ''

  useEffect(() => {
    setApiKeyState(connection)
    setConnected(subscription.status === 'connected')
  }, [connection, subscription.status])

  useEffect(
    () => () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current)
      }
    },
    []
  )

  function stopPolling(): void {
    if (pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }

  function finishConnected(): void {
    stopPolling()
    setFlow(null)
    setBusy('')
    setConnected(true)
    setMessage(`${label} is connected.`)
    onSnapshot(null)
  }

  async function poll(): Promise<void> {
    try {
      const status = await pollCodevCursorConnect()
      if (status === 'connected') {
        finishConnected()
        return
      }
      if (status === 'denied') {
        stopPolling()
        setFlow(null)
        setBusy('')
        setMessage(`${label} sign-in was cancelled.`)
        return
      }
      if (pollStartedAt.current > 0 && Date.now() - pollStartedAt.current > 90_000) {
        setMessage(
          'Still waiting on Cursor. If you already finished signing in, connect with an API key below instead.'
        )
      }
    } catch (error) {
      stopPolling()
      setFlow(null)
      setBusy('')
      setMessage(error instanceof Error ? error.message : `${label} sign-in failed. Start again.`)
    }
  }

  async function connect(): Promise<void> {
    setBusy('connect')
    setMessage('')
    setFlow(null)
    stopPolling()
    try {
      const { loginUrl } = await startCodevCursorConnect()
      window.open(loginUrl, '_blank', 'noopener,noreferrer')
      setFlow({ kind: 'polling', loginUrl })
      pollStartedAt.current = Date.now()
      void poll()
      pollTimer.current = setInterval(() => void poll(), 2000)
    } catch (error) {
      setBusy('')
      setMessage(error instanceof Error ? error.message : `${label} sign-in could not start.`)
    }
  }

  async function disconnect(): Promise<void> {
    setBusy('disconnect')
    setMessage('')
    try {
      const snapshot = await revokeCodevProviderSubscription(subscription.provider)
      setConnected(false)
      setMessage(`${label} disconnected.`)
      onSnapshot(snapshot)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The account could not be disconnected.')
    } finally {
      setBusy('')
    }
  }

  async function save(): Promise<void> {
    setBusy('save')
    setMessage('')
    try {
      if (model.isCursor) {
        await completeCodevCursorApiKey(draft.trim())
        setDraft('')
        finishConnected()
        return
      }
      const snapshot = await putCodevProviderApiKey({
        provider: connection.provider,
        apiKey: draft.trim(),
        ...(surface ? { surface } : {})
      })
      const next = snapshot.connections.find((row) => row.provider === connection.provider)
      if (next) {
        setApiKeyState(next)
      }
      setDraft('')
      setMessage(`${connection.label} API key saved.`)
      onSnapshot(snapshot)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The key could not be saved.')
    } finally {
      setBusy('')
    }
  }

  async function revoke(): Promise<void> {
    setBusy('revoke')
    setMessage('')
    try {
      const snapshot = await revokeCodevProviderConnection({ provider: connection.provider })
      const next = snapshot.connections.find((row) => row.provider === connection.provider)
      if (next) {
        setApiKeyState(next)
      }
      setDraft('')
      setMessage(`${connection.label} API key revoked.`)
      onSnapshot(snapshot)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The key could not be revoked.')
    } finally {
      setBusy('')
    }
  }

  async function setSurface(
    kind: 'api_key' | 'subscription' | 'claude_cli_token',
    target: CodevProviderSurface,
    enabled: boolean
  ): Promise<void> {
    setBusy('save')
    setMessage('')
    try {
      const snapshot = await patchCodevProviderSurface({
        provider: connection.provider,
        kind,
        surface: target,
        enabled
      })
      setMessage(
        enabled
          ? `${label} will also be used in ${target === 'rooms' ? 'chat rooms' : 'coding workspaces'}.`
          : `${label} is no longer used in ${target === 'rooms' ? 'chat rooms' : 'coding workspaces'}.`
      )
      onSnapshot(snapshot)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The setting could not be saved.')
    } finally {
      setBusy('')
    }
  }

  async function revokeClaudeCliToken(): Promise<void> {
    setBusy('revoke')
    setMessage('')
    try {
      const snapshot = await revokeCodevProviderConnection({
        provider: 'anthropic',
        kind: 'claude_cli_token'
      })
      setMessage(`${label} CLI login revoked.`)
      onSnapshot(snapshot)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The CLI login could not be revoked.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 px-4 py-3.5 shadow-xs">
      <div className="flex items-center gap-2.5">
        <span className="flex size-6 items-center justify-center text-foreground">{logo}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{label}</h3>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CodevStatusDot connected={model.surfaceReady ?? model.workspaceLoginConnected} />
            {model.headerStatus}
          </p>
        </div>
        <CodevProviderAccountCardActions
          busy={busy}
          connected={connected}
          disabled={disabled}
          label={label}
          model={model}
          onConnect={() => void connect()}
          onDisconnect={() => void disconnect()}
          onRevokeClaudeCli={() => void revokeClaudeCliToken()}
          subscriptionProvider={subscription.provider}
        />
      </div>

      {model.showClaudeConnect ? (
        <CodevHostedClaudeConnect connected={connected} onConnected={finishConnected} />
      ) : null}
      {model.showCodexConnect ? (
        <CodevHostedCodexConnect connected={connected} onConnected={finishConnected} />
      ) : null}

      {flow?.kind === 'polling' ? (
        <div className="mt-3 flex items-center gap-2.5 rounded-md border border-border bg-background/60 p-3">
          <p className="flex-1 text-xs text-muted-foreground">
            Finish signing in on the {label} tab (
            <a className="underline" href={flow.loginUrl} rel="noreferrer" target="_blank">
              reopen
            </a>
            ). Keep this page open…
          </p>
          <Button
            onClick={() => {
              stopPolling()
              setFlow(null)
              setBusy('')
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
        </div>
      ) : null}

      <CodevProviderAccountCardMethods
        apiKeyState={apiKeyState}
        busy={busy}
        claudeCliToken={claudeCliToken}
        connection={connection}
        disabled={disabled}
        draft={draft}
        label={label}
        model={model}
        onDraftChange={setDraft}
        onRevoke={() => void revoke()}
        onSave={() => void save()}
        onSetSurface={(kind, target, enabled) => void setSurface(kind, target, enabled)}
        subscription={subscription}
      />

      {message ? (
        <p className="pt-2.5 text-[11px] text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}
