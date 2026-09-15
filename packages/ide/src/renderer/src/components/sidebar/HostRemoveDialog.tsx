import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { HostRemovalTarget } from './host-rename-remove'

type HostRemoveDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  hostId: ExecutionHostId
  label: string
  target: NonNullable<HostRemovalTarget>
}

export function HostRemoveDialog({
  open,
  onOpenChange,
  label,
  target
}: HostRemoveDialogProps): React.JSX.Element {
  // Why: runtime-environment removal needs active-environment switching and
  // error context owned by the Orca servers settings pane, so we deep-link
  // there with the host pre-selected instead of duplicating that flow.
  const handleRemoveRuntime = (environmentId: string): void => {
    const state = useAppStore.getState()
    state.openSettingsTarget({ pane: 'servers', repoId: null, sectionId: environmentId })
    state.openSettingsPage()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.sidebar.HostRemoveDialog.3c4d5e6f7a',
              'Remove {{value0}}?',
              {
                value0: label
              }
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.sidebar.HostRemoveDialog.4d5e6f7a8b',
              'This opens the Orca servers settings where you can remove this server.'
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {translate('auto.components.sidebar.HostRemoveDialog.6f7a8b9c0d', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => handleRemoveRuntime(target.environmentId)}
          >
            {translate('auto.components.sidebar.HostRemoveDialog.7a8b9c0d1e', 'Open settings')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
