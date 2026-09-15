import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { translate } from '@/i18n/i18n'
import {
  translateHostAccessLinkError,
  translateRemotePairingEndpointKind
} from '@/lib/remote-pairing-copy'
import type { ParseHostAccessLinkResult } from '../../../../shared/remote-pairing-address'

export function RemoteServerFields({
  name,
  pairingCode,
  parsedLink,
  disabled,
  onNameChange,
  onPairingCodeChange,
  allowLoopback,
  onAllowLoopbackChange,
  onSubmit
}: {
  name: string
  pairingCode: string
  parsedLink: ParseHostAccessLinkResult
  disabled: boolean
  onNameChange: (value: string) => void
  onPairingCodeChange: (value: string) => void
  allowLoopback: boolean
  onAllowLoopbackChange: (value: boolean) => void
  onSubmit: () => void
}) {
  const inputError = pairingCode.trim() !== '' && !parsedLink.ok
  const loopbackBlocked =
    parsedLink.ok && parsedLink.value.endpointKind === 'loopback' && !allowLoopback
  const pairingCodeDescriptionId = inputError
    ? 'add-server-pairing-code-error'
    : loopbackBlocked
      ? 'add-server-loopback-blocked'
      : 'add-server-pairing-code-help'
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="add-server-name">
          {translate('auto.components.sidebar.AddRemoteHostDialog.serverName', 'Name in Orca')}
        </Label>
        <Input
          id="add-server-name"
          value={name}
          disabled={disabled}
          autoFocus
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={translate(
            'auto.components.sidebar.AddRemoteHostDialog.serverNamePlaceholder',
            'Dev box'
          )}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="add-server-pairing-code">
          {translate('auto.components.sidebar.AddRemoteHostDialog.pairingCode', 'Access link')}
        </Label>
        <Input
          id="add-server-pairing-code"
          aria-invalid={inputError || loopbackBlocked}
          aria-describedby={pairingCodeDescriptionId}
          value={pairingCode}
          disabled={disabled}
          onChange={(event) => onPairingCodeChange(event.target.value)}
          placeholder={translate(
            'auto.components.sidebar.AddRemoteHostDialog.pairingCodePlaceholder',
            'codev://pair?code=...'
          )}
          className="font-mono"
        />
        <p id="add-server-pairing-code-help" className="text-xs text-muted-foreground">
          {translate(
            'auto.components.sidebar.AddRemoteHostDialog.pairingHelpSuffix',
            'Create this under Settings → Remote Orca Servers → Share this host on the other computer.'
          )}
        </p>
        {inputError ? (
          <p id="add-server-pairing-code-error" role="alert" className="text-xs text-destructive">
            {parsedLink.ok ? null : translateHostAccessLinkError(parsedLink.kind)}
          </p>
        ) : null}
      </div>
      {parsedLink.ok ? (
        <div className="space-y-1 rounded-md border border-border/60 p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            {translate(
              'auto.components.sidebar.AddRemoteHostDialog.linkDestination',
              'Link destination'
            )}
            <Badge variant="outline">
              {translateRemotePairingEndpointKind(parsedLink.value.endpointKind)}
            </Badge>
          </div>
          <div className="font-mono text-sm">{parsedLink.value.displayEndpoint}</div>
          {parsedLink.value.endpointKind === 'loopback' ? (
            <label className="mt-2 flex items-start gap-2 text-xs">
              <Checkbox
                checked={allowLoopback}
                disabled={disabled}
                onCheckedChange={(checked) => onAllowLoopbackChange(checked === true)}
              />
              <span>
                <span className="block font-medium">
                  {translate(
                    'auto.components.sidebar.AddRemoteHostDialog.sshTunnel',
                    'I am using a local port forward to the other computer'
                  )}
                </span>
                <span className="text-muted-foreground">
                  {translate(
                    'auto.components.sidebar.AddRemoteHostDialog.sshTunnelHelp',
                    'Otherwise, this link points back to this device and cannot identify the other computer.'
                  )}
                </span>
              </span>
            </label>
          ) : null}
        </div>
      ) : null}
      {loopbackBlocked ? (
        <p id="add-server-loopback-blocked" role="alert" className="text-xs text-destructive">
          {translate(
            'auto.components.sidebar.AddRemoteHostDialog.loopbackBlocked',
            'Enable the local port-forward override or create a new link using the other host’s Tailscale or LAN address.'
          )}
        </p>
      ) : null}
    </form>
  )
}
