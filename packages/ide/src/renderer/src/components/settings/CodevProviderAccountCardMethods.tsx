import { KeyRound, Terminal } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  CodevCopyableCommand,
  CodevFallbackRow,
  CodevSurfaceToggle
} from './codev-provider-account-card-controls'
import type { CodevProviderCardModel } from './codev-provider-account-card-model'
import type {
  CodevCliSubscriptionRecord,
  CodevClaudeCliTokenRecord,
  CodevProviderConnectionRecord,
  CodevProviderSurface
} from './codev-provider-connection-types'

export function CodevProviderAccountCardMethods({
  model,
  label,
  subscription,
  connection,
  claudeCliToken,
  apiKeyState,
  draft,
  disabled,
  busy,
  onDraftChange,
  onSave,
  onRevoke,
  onSetSurface
}: {
  model: CodevProviderCardModel
  label: string
  subscription: CodevCliSubscriptionRecord
  connection: CodevProviderConnectionRecord
  claudeCliToken?: CodevClaudeCliTokenRecord
  apiKeyState: CodevProviderConnectionRecord
  draft: string
  disabled: boolean
  busy: string
  onDraftChange: (value: string) => void
  onSave: () => void
  onRevoke: () => void
  onSetSurface: (
    kind: 'api_key' | 'subscription' | 'claude_cli_token',
    target: CodevProviderSurface,
    enabled: boolean
  ) => void
}): ReactNode {
  const provider = connection.provider
  const apiKeyLabel = `${connection.label} API key`

  return (
    <div className="mt-3">
      {!model.offerApiKey ? (
        <p className="border-t border-border/60 py-2.5 text-[11px] text-muted-foreground">
          API key support for chat rooms is coming soon. For now, sign in with your subscription
          above or from your terminal.
        </p>
      ) : null}
      {model.offerApiKey ? (
        <CodevFallbackRow
          connected={apiKeyState.status === 'connected'}
          defaultOpen={
            model.workspaceSurface
              ? !model.workspaceLoginConnected && apiKeyState.status !== 'connected'
              : !model.showHostedConnect
          }
          description={
            model.isCursor
              ? 'From cursor.com → Dashboard → API Keys. More reliable than the browser sign-in — CoDev exchanges it for a real session.'
              : `Bill usage to your own ${connection.label} account instead of a subscription.`
          }
          icon={KeyRound}
          title={model.isCursor ? 'Connect with a Cursor API key' : 'Use an API key instead'}
        >
          {apiKeyState.status === 'connected' ? (
            <p className="text-xs text-muted-foreground">
              Saved by {apiKeyState.suppliedBy} · ending {apiKeyState.lastFour}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`codev-api-key-${provider}`}>
              {apiKeyLabel}
            </label>
            <Input
              autoComplete="off"
              className="min-w-[12rem] flex-1"
              disabled={disabled}
              id={`codev-api-key-${provider}`}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={model.isCursor ? 'key_…' : 'Paste API key'}
              spellCheck={false}
              type="password"
              value={draft}
            />
            <Button
              disabled={disabled || !draft.trim()}
              onClick={onSave}
              size="sm"
              type="button"
              variant="outline"
            >
              {busy === 'save'
                ? model.isCursor
                  ? 'Connecting…'
                  : 'Saving…'
                : model.isCursor
                  ? 'Connect'
                  : apiKeyState.status === 'connected'
                    ? 'Replace key'
                    : 'Save key'}
            </Button>
            {apiKeyState.status === 'connected' ? (
              <Button
                disabled={disabled}
                onClick={onRevoke}
                size="sm"
                type="button"
                variant="secondary"
              >
                {busy === 'revoke' ? 'Revoking…' : 'Revoke'}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Keys are encrypted on the CoDev server and never shown again after you save them.
          </p>
        </CodevFallbackRow>
      ) : null}

      {subscription.command ? (
        <CodevFallbackRow
          connected={
            model.workspaceSurface
              ? model.workspaceLoginConnected
              : subscription.status === 'connected' && subscription.provenance === 'cli'
          }
          defaultOpen={
            model.workspaceSurface
              ? !model.workspaceLoginConnected && apiKeyState.status !== 'connected'
              : !model.showHostedConnect
          }
          description={
            model.workspaceSurface
              ? 'Sign in from your own terminal. This login can also power chat rooms.'
              : 'Run the same sign-in from the CoDev CLI. A terminal login can also power coding workspaces.'
          }
          icon={Terminal}
          title="Connect from a terminal"
        >
          {model.workspaceSurface &&
          subscription.provider === 'claude' &&
          model.cliTokenConnected ? (
            <p className="text-xs text-muted-foreground">
              Connected via codev claude-auth
              {claudeCliToken?.lastFour ? ` · ending ${claudeCliToken.lastFour}` : ''}
            </p>
          ) : null}
          <CodevCopyableCommand command="npm install -g @trycodev/cli" />
          <CodevCopyableCommand command="codev login" />
          <CodevCopyableCommand command={subscription.command} />
        </CodevFallbackRow>
      ) : null}

      {model.roomsSurface && subscription.status === 'connected' && subscription.provenance ? (
        subscription.provider === 'codex' ? (
          <CodevSurfaceToggle
            checked={subscription.enabledForWorkspace ?? true}
            disabled={disabled}
            label="Also use in coding workspaces"
            note="Your Codex sign-in runs in your private workspace session."
            onChange={(next) => onSetSurface('subscription', 'workspace', next)}
          />
        ) : (
          <p className="border-t border-border/60 py-2.5 text-[11px] text-muted-foreground">
            Browser sign-ins stay in chat rooms. To use {label} in coding workspaces, add an API key
            or sign in from your terminal there.
          </p>
        )
      ) : null}

      {model.workspaceSurface &&
      subscription.provider === 'codex' &&
      model.workspaceLoginConnected ? (
        <CodevSurfaceToggle
          checked={subscription.enabledForRooms ?? true}
          disabled={disabled}
          label="Also use in chat rooms"
          note="Your terminal login can answer in chat rooms too."
          onChange={(next) => onSetSurface('subscription', 'rooms', next)}
        />
      ) : null}

      {model.workspaceSurface && apiKeyState.status === 'connected' ? (
        <p className="border-t border-border/60 py-2.5 text-[11px] text-muted-foreground">
          API keys stay in coding workspaces; chat rooms run on a subscription.
        </p>
      ) : null}
    </div>
  )
}
