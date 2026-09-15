import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import {
  getSettingsFocusedExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import type { AddRepoDialogStep } from './add-repo-dialog-types'
import { useSidebarHostScopeOptions } from './use-sidebar-host-scope-options'
import { canSelectAddRepoHost } from './add-repo-host-availability'

export function useAddRepoHostSelection({
  isOpen,
  setStep
}: {
  isOpen: boolean
  setStep: (step: AddRepoDialogStep) => void
}): {
  hostOptions: ReturnType<typeof useSidebarHostScopeOptions>['hostOptions']
  selectedHostId: ExecutionHostId
  selectedParsedHost: ReturnType<typeof parseExecutionHostId>
  hostSelectorOpen: boolean
  setHostSelectorOpen: (open: boolean) => void
  handleSelectAddProjectHost: (hostId: ExecutionHostId) => Promise<void>
} {
  const settings = useAppStore((s) => s.settings)
  const { hostOptions } = useSidebarHostScopeOptions()
  const selectableHostOptions = hostOptions
  const [selectedAddProjectHostId, setSelectedAddProjectHostId] =
    useState<ExecutionHostId>(LOCAL_EXECUTION_HOST_ID)
  const [hostSelectorOpen, setHostSelectorOpen] = useState(false)
  const previousOpenRef = useRef(false)

  const selectedHost =
    selectableHostOptions.find(
      (host) => host.id === selectedAddProjectHostId && canSelectAddRepoHost(host)
    ) ??
    selectableHostOptions.find(
      (host) => host.id === LOCAL_EXECUTION_HOST_ID && canSelectAddRepoHost(host)
    ) ??
    selectableHostOptions.find((host) => canSelectAddRepoHost(host)) ??
    selectableHostOptions[0]
  const selectedHostId = selectedHost?.id ?? LOCAL_EXECUTION_HOST_ID
  const selectedParsedHost = parseExecutionHostId(selectedHostId)

  useEffect(() => {
    if (isOpen && !previousOpenRef.current) {
      const focusedHostId = getSettingsFocusedExecutionHostId(settings)
      const nextHostId = selectableHostOptions.some(
        (host) => host.id === focusedHostId && canSelectAddRepoHost(host)
      )
        ? focusedHostId
        : LOCAL_EXECUTION_HOST_ID
      setSelectedAddProjectHostId(nextHostId)
    }
    if (!isOpen) {
      setHostSelectorOpen(false)
    }
    previousOpenRef.current = isOpen
  }, [isOpen, selectableHostOptions, settings])

  const handleSelectAddProjectHost = useCallback(
    async (hostId: ExecutionHostId): Promise<void> => {
      const host = selectableHostOptions.find((candidate) => candidate.id === hostId)
      if (!host || !canSelectAddRepoHost(host)) {
        return
      }
      setSelectedAddProjectHostId(hostId)
      setStep('add')
    },
    [selectableHostOptions, setStep]
  )

  return {
    hostOptions: selectableHostOptions,
    selectedHostId,
    selectedParsedHost,
    hostSelectorOpen,
    setHostSelectorOpen,
    handleSelectAddProjectHost
  }
}
