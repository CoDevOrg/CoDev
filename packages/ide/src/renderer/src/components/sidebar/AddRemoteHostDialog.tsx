import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { parseHostAccessLink } from '../../../../shared/remote-pairing-address'
import {
  translateHostAccessLinkError,
  translateRemotePairingFailureDescription
} from '@/lib/remote-pairing-copy'
import { AddRemoteHostServerFormPanel } from './AddRemoteHostServerFormPanel'

export type AddRemoteHostMode = 'server'

type AddRemoteHostDialogProps = {
  mode: AddRemoteHostMode | null
  onOpenChange: (mode: AddRemoteHostMode | null) => void
}

export function AddRemoteHostDialog({
  mode,
  onOpenChange
}: AddRemoteHostDialogProps): React.JSX.Element {
  const open = mode !== null
  const [serverName, setServerName] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [allowLoopback, setAllowLoopback] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const parsedServerLink = useMemo(() => parseHostAccessLink(pairingCode), [pairingCode])
  const serverFormCanSubmit =
    serverName.trim() !== '' &&
    parsedServerLink.ok &&
    (parsedServerLink.value.endpointKind !== 'loopback' || allowLoopback)
  const setRuntimeEnvironments = useAppStore((s) => s.setRuntimeEnvironments)
  const setRuntimeEnvironmentStatus = useAppStore((s) => s.setRuntimeEnvironmentStatus)

  const reset = () => {
    setServerName('')
    setPairingCode('')
    setAllowLoopback(false)
  }

  const close = () => {
    if (isSaving) {
      return
    }
    reset()
    onOpenChange(null)
  }

  const saveRemoteServer = async () => {
    const trimmedName = serverName.trim()
    const trimmedPairingCode = pairingCode.trim()
    if (!trimmedName || !trimmedPairingCode) {
      toast.error(
        translate(
          'auto.components.sidebar.AddRemoteHostDialog.serverFieldsRequired',
          'Server name and pairing code are required.'
        )
      )
      return
    }
    if (!parsedServerLink.ok) {
      toast.error(translateHostAccessLinkError(parsedServerLink.kind))
      return
    }
    if (parsedServerLink.value.endpointKind === 'loopback' && !allowLoopback) {
      toast.error(
        translate(
          'auto.components.sidebar.AddRemoteHostDialog.loopbackBlocked',
          'Enable the local port-forward override or create a new link using the other host’s Tailscale or LAN address.'
        )
      )
      return
    }

    setIsSaving(true)
    try {
      const result = await window.api.runtimeEnvironments.verifyAndAddFromPairingCode({
        name: trimmedName,
        pairingCode: trimmedPairingCode,
        allowLoopback
      })
      if (!result.ok) {
        toast.error(
          result.kind === 'environment-save-failed'
            ? result.message
            : translateRemotePairingFailureDescription(
                result.kind,
                parsedServerLink.value.displayEndpoint
              )
        )
        return
      }
      const environments = await window.api.runtimeEnvironments.list()
      setRuntimeEnvironments(environments)
      setRuntimeEnvironmentStatus(result.environment.id, {
        status: result.runtimeStatus,
        checkedAt: Date.now()
      })
      toast.success(
        translate('auto.components.sidebar.AddRemoteHostDialog.serverSaved', 'Remote server added.')
      )
      reset()
      onOpenChange(null)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.sidebar.AddRemoteHostDialog.serverSaveFailed',
              'Failed to add remote server.'
            )
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          close()
        }
      }}
    >
      <DialogContent className="scrollbar-sleek max-h-[min(90vh,560px)] overflow-y-auto sm:max-w-xl">
        <AddRemoteHostServerFormPanel
          name={serverName}
          pairingCode={pairingCode}
          parsedLink={parsedServerLink}
          allowLoopback={allowLoopback}
          disabled={isSaving}
          canSubmit={serverFormCanSubmit}
          onNameChange={setServerName}
          onPairingCodeChange={(value) => {
            setPairingCode(value)
            setAllowLoopback(false)
          }}
          onAllowLoopbackChange={setAllowLoopback}
          onSubmit={() => void saveRemoteServer()}
          onCancel={close}
        />
      </DialogContent>
    </Dialog>
  )
}
