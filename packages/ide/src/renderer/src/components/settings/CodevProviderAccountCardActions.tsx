import type { JSX } from 'react'

import { Button } from '@/components/ui/button'
import type { CodevProviderCardModel } from './codev-provider-account-card-model'
import type { CodevCliSubscriptionRecord } from './codev-provider-connection-types'

export function CodevProviderAccountCardActions({
  model,
  connected,
  subscriptionProvider,
  label,
  disabled,
  busy,
  onConnect,
  onDisconnect,
  onRevokeClaudeCli
}: {
  model: CodevProviderCardModel
  connected: boolean
  subscriptionProvider: CodevCliSubscriptionRecord['provider']
  label: string
  disabled: boolean
  busy: string
  onConnect: () => void
  onDisconnect: () => void
  onRevokeClaudeCli: () => void
}): JSX.Element | null {
  if (model.workspaceSurface) {
    if (subscriptionProvider === 'claude' && model.cliTokenConnected) {
      return (
        <Button
          disabled={disabled}
          onClick={onRevokeClaudeCli}
          size="sm"
          type="button"
          variant="outline"
        >
          {busy === 'revoke' ? 'Revoking…' : 'Revoke CLI login'}
        </Button>
      )
    }
    if (subscriptionProvider === 'codex' && model.workspaceLoginConnected) {
      return (
        <Button
          disabled={disabled}
          onClick={onDisconnect}
          size="sm"
          type="button"
          variant="outline"
        >
          {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
        </Button>
      )
    }
    return null
  }

  if (model.isCursor && model.offerBrowserConnect) {
    if (connected) {
      return (
        <div className="flex shrink-0 gap-2">
          <Button disabled={disabled} onClick={onConnect} size="sm" type="button" variant="outline">
            Reconnect
          </Button>
          <Button
            disabled={disabled}
            onClick={onDisconnect}
            size="sm"
            type="button"
            variant="outline"
          >
            {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </div>
      )
    }
    return (
      <Button className="shrink-0" disabled={disabled} onClick={onConnect} size="sm" type="button">
        {busy === 'connect' ? 'Starting…' : `Connect ${label}`}
      </Button>
    )
  }

  if (connected) {
    return (
      <Button disabled={disabled} onClick={onDisconnect} size="sm" type="button" variant="outline">
        {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
      </Button>
    )
  }
  return null
}
