/* oxlint-disable max-lines -- Why: co-locates forwarded list, detected list, modal form, and
per-entry actions in one file to keep the data flow straightforward. */
import React, { useCallback, useMemo, useState } from 'react'
import {
  ExternalLink,
  Copy,
  Trash2,
  ChevronRight,
  RefreshCw,
  Server,
  Box,
  Info
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { cn } from '@/lib/utils'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import {
  killWorkspacePortForTarget,
  getPortOpenBrowserTooltipLabel,
  openWorkspacePortInBrowser,
  refreshWorkspacePortScanAfterStop,
  resolvePortOpenInOrcaBrowser,
  scanWorkspacePortsForTarget,
  workspacePortRuntimeTargetKey
} from '@/lib/workspace-port-actions'
import { addressForPort } from '@/lib/workspace-port-urls'
import { resolveLocalhostLabelRouteForPort } from '@/lib/workspace-port-localhost-label-selector'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import { translate } from '@/i18n/i18n'

export {
  killWorkspacePortForTarget,
  openWorkspacePortInBrowser,
  scanWorkspacePortsForTarget
} from '@/lib/workspace-port-actions'

export function getLocalWorkspacePortSections(
  scan: { ports: WorkspacePort[] } | null | undefined,
  activeRepoId: string | null | undefined,
  activeWorktreeId: string | null | undefined
): {
  activePorts: WorkspacePort[]
  otherWorkspacePorts: WorkspacePort[]
  externalPorts: WorkspacePort[]
} {
  const ports = scan?.ports ?? []
  return {
    activePorts: ports.filter(
      (port) =>
        port.kind === 'workspace' &&
        port.owner.repoId === activeRepoId &&
        port.owner.worktreeId === activeWorktreeId
    ),
    otherWorkspacePorts: ports.filter(
      (port) =>
        port.kind === 'workspace' &&
        port.owner.repoId === activeRepoId &&
        port.owner.worktreeId !== activeWorktreeId
    ),
    // Why: the old repo-scoped scan showed listeners from other repos as
    // External, without workspace-only actions or cross-worktree activation.
    // Keep that behavior now that the shared scan can attribute them globally.
    externalPorts: ports.flatMap((port) => {
      if (port.kind !== 'workspace') {
        return [port]
      }
      return port.owner.repoId === activeRepoId ? [] : [workspacePortAsExternal(port)]
    })
  }
}

function workspacePortAsExternal(port: WorkspacePort & { kind: 'workspace' }): WorkspacePort {
  return {
    id: port.id,
    bindHost: port.bindHost,
    connectHost: port.connectHost,
    port: port.port,
    pid: port.pid,
    processName: port.processName,
    protocol: port.protocol,
    kind: 'external'
  }
}

const LOCAL_PORT_MENU_CONTENT_CLASS =
  '!rounded-md !border-border/60 !bg-popover !text-popover-foreground !shadow-[0_10px_24px_rgba(0,0,0,0.18)] !backdrop-blur-none'
const LOCAL_PORT_MENU_ITEM_CLASS =
  'rounded-md focus:bg-accent focus:text-accent-foreground dark:focus:bg-accent'
const LOCAL_PORT_MENU_LABEL_CLASS = 'px-2 py-1 text-[11px] font-semibold text-muted-foreground'

export default function PortsPanel({ isVisible }: { isVisible: boolean }): React.JSX.Element {
  return <LocalWorkspacePortsPanel isVisible={isVisible} />
}

function LocalWorkspacePortsPanel({ isVisible }: { isVisible: boolean }): React.JSX.Element {
  const activeWorktree = useActiveWorktree()
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  const settings = useAppStore((s) => s.settings)
  const createBrowserTab = useAppStore((s) => s.createBrowserTab)
  const setRemoteBrowserPageHandle = useAppStore((s) => s.setRemoteBrowserPageHandle)
  const scansByKey = useAppStore((s) => s.workspacePortScansByKey)
  const refreshing = useAppStore((s) => s.workspacePortScanRefreshing)
  const setWorkspacePortScan = useAppStore((s) => s.setWorkspacePortScan)
  const setWorkspacePortScanForKey = useAppStore((s) => s.setWorkspacePortScanForKey)
  const setWorkspacePortScanRefreshing = useAppStore((s) => s.setWorkspacePortScanRefreshing)
  const [detailsPort, setDetailsPort] = useState<WorkspacePort | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    other: true,
    external: true
  })

  const runtimeTarget = useMemo(() => {
    const activeRuntimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(
      useAppStore.getState(),
      activeWorktree?.id
    )
    // Why: the Ports panel acts on the active workspace; use that workspace's
    // host owner even if the sidebar is focused elsewhere.
    return getActiveRuntimeTarget({ ...settings, activeRuntimeEnvironmentId })
  }, [activeWorktree?.id, settings])
  const scanKey = `${workspacePortRuntimeTargetKey(runtimeTarget)}:all`

  const refresh = useCallback(() => {
    if (!activeRepo) {
      return Promise.resolve()
    }
    setWorkspacePortScanRefreshing(true)
    const promise = scanWorkspacePortsForTarget(runtimeTarget)
      .then((nextScan) => {
        setWorkspacePortScanForKey(scanKey, nextScan)
        setWorkspacePortScan({ key: scanKey, result: nextScan })
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        toast.error(
          translate(
            'auto.components.right.sidebar.PortsPanel.a00f3a2840',
            'Failed to refresh ports'
          ),
          {
            description:
              message ||
              translate(
                'auto.components.right.sidebar.PortsPanel.740aca88ab',
                'Workspace port scan failed.'
              )
          }
        )
      })
      .finally(() => {
        setWorkspacePortScanRefreshing(false)
      })
    return promise
  }, [
    activeRepo,
    runtimeTarget,
    scanKey,
    setWorkspacePortScan,
    setWorkspacePortScanForKey,
    setWorkspacePortScanRefreshing
  ])

  // Why: WorkspacePortScanner already owns the 30s all-worktree poll. The
  // panel scopes that shared result instead of starting a second scan loop.
  const displayScan = isVisible ? (scansByKey[scanKey] ?? null) : null

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((current) => ({ ...current, [sectionId]: !current[sectionId] }))
  }, [])

  const handleStopPort = useCallback(
    async (port: WorkspacePort) => {
      if (!activeRepo || !port.pid) {
        return
      }
      const result = await killWorkspacePortForTarget(runtimeTarget, {
        repoId: activeRepo.id,
        pid: port.pid,
        port: port.port
      })
      if (!result.ok) {
        toast.error(result.reason)
        return
      }
      toast.success(
        translate(
          'auto.components.right.sidebar.PortsPanel.97b562d21d',
          'Stopped process on :{{value0}}',
          { value0: port.port }
        )
      )
      const refreshResult = await refreshWorkspacePortScanAfterStop({
        runtimeTarget,
        setWorkspacePortScan,
        setWorkspacePortScanForKey,
        getWorkspacePortScansByKey: () => useAppStore.getState().workspacePortScansByKey,
        setWorkspacePortScanRefreshing
      })
      if (!refreshResult.ok) {
        toast.error(
          translate(
            'auto.components.right.sidebar.PortsPanel.a00f3a2840',
            'Failed to refresh ports'
          ),
          {
            description: refreshResult.reason
          }
        )
      }
    },
    [
      activeRepo,
      runtimeTarget,
      setWorkspacePortScan,
      setWorkspacePortScanForKey,
      setWorkspacePortScanRefreshing
    ]
  )

  const handleOpenPortInBrowser = useCallback(
    async (port: WorkspacePort, event?: React.MouseEvent<HTMLButtonElement>) => {
      const result = await openWorkspacePortInBrowser({
        port,
        activeWorktreeId: activeWorktree?.id,
        runtimeTarget,
        createBrowserTab,
        setRemoteBrowserPageHandle,
        openInOrcaBrowser: resolvePortOpenInOrcaBrowser({
          settings,
          event,
          isMac: navigator.userAgent.includes('Mac')
        }),
        localhostLabelRoute: resolveLocalhostLabelRouteForPort(useAppStore.getState(), port)
      })
      if (!result.ok) {
        toast.error(
          translate(
            'auto.components.right.sidebar.PortsPanel.98e9a414f8',
            'Failed to open browser'
          ),
          { description: result.reason }
        )
      }
    },
    [activeWorktree?.id, createBrowserTab, runtimeTarget, setRemoteBrowserPageHandle, settings]
  )

  const { activePorts, otherWorkspacePorts, externalPorts } = useMemo(
    () => getLocalWorkspacePortSections(displayScan, activeRepo?.id, activeWorktree?.id),
    [activeRepo?.id, activeWorktree?.id, displayScan]
  )

  if (!activeRepo) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center text-muted-foreground">
        <Server size={32} className="mb-3 opacity-50" />
        <p className="text-sm">
          {translate(
            'auto.components.right.sidebar.PortsPanel.c1b115c375',
            'No workspace selected'
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-sleek">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {translate('auto.components.right.sidebar.PortsPanel.6bc058dbe1', 'Ports')}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => void refresh()}
              disabled={refreshing}
              aria-label={translate(
                'auto.components.right.sidebar.PortsPanel.7822e3edc6',
                'Refresh Ports'
              )}
            >
              <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {translate('auto.components.right.sidebar.PortsPanel.7822e3edc6', 'Refresh Ports')}
          </TooltipContent>
        </Tooltip>
      </div>

      {displayScan?.unavailableReason && (
        <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
          {translate(
            'auto.components.right.sidebar.PortsPanel.f59c783b7a',
            'Port scan unavailable on {{value0}}: {{value1}}',
            {
              value0: displayScan.platform,
              value1: displayScan.unavailableReason
            }
          )}
        </div>
      )}

      {!displayScan?.unavailableReason && (
        <>
          <LocalPortSection
            id="active"
            title={translate(
              'auto.components.right.sidebar.PortsPanel.935dda7718',
              'Active Workspace'
            )}
            ports={activePorts}
            emptyText={
              refreshing && !displayScan
                ? translate('auto.components.right.sidebar.PortsPanel.0d63d94db3', 'Scanning...')
                : translate(
                    'auto.components.right.sidebar.PortsPanel.38b16cfbef',
                    'No ports detected'
                  )
            }
            collapsed={collapsedSections.active ?? false}
            onToggle={() => toggleSection('active')}
            onStopPort={(port) => void handleStopPort(port)}
            onShowDetails={setDetailsPort}
            onOpenInBrowser={handleOpenPortInBrowser}
          />
          <LocalPortSection
            id="other"
            title={translate(
              'auto.components.right.sidebar.PortsPanel.4db4b5e435',
              'Other Workspaces'
            )}
            ports={otherWorkspacePorts}
            collapsed={collapsedSections.other ?? false}
            onToggle={() => toggleSection('other')}
            onStopPort={(port) => void handleStopPort(port)}
            onShowDetails={setDetailsPort}
            onOpenInBrowser={handleOpenPortInBrowser}
          />
          <LocalPortSection
            id="external"
            title={translate('auto.components.right.sidebar.PortsPanel.d32820d3e2', 'External')}
            ports={externalPorts}
            collapsed={collapsedSections.external ?? false}
            onToggle={() => toggleSection('external')}
            onStopPort={(port) => void handleStopPort(port)}
            onShowDetails={setDetailsPort}
            onOpenInBrowser={handleOpenPortInBrowser}
          />
        </>
      )}

      {!displayScan?.unavailableReason &&
        displayScan &&
        activePorts.length === 0 &&
        otherWorkspacePorts.length === 0 &&
        externalPorts.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 px-4 text-center text-muted-foreground">
            <Server size={32} className="mb-3 opacity-50" />
            <p className="text-sm">
              {translate(
                'auto.components.right.sidebar.PortsPanel.a2a9fc6899',
                'No local ports detected'
              )}
            </p>
          </div>
        )}

      <LocalPortDetailsDialog port={detailsPort} onClose={() => setDetailsPort(null)} />
    </div>
  )
}

function LocalPortSection({
  id,
  title,
  ports,
  emptyText,
  collapsed,
  onToggle,
  onStopPort,
  onShowDetails,
  onOpenInBrowser
}: {
  id: string
  title: string
  ports: WorkspacePort[]
  emptyText?: string
  collapsed: boolean
  onToggle: () => void
  onStopPort: (port: WorkspacePort) => void
  onShowDetails: (port: WorkspacePort) => void
  onOpenInBrowser: (port: WorkspacePort, event?: React.MouseEvent<HTMLButtonElement>) => void
}): React.JSX.Element | null {
  if (ports.length === 0 && !emptyText) {
    return null
  }

  return (
    <div className="px-3 pt-2">
      <button
        type="button"
        className="sticky top-0 z-10 mb-1 flex w-full items-center gap-1 border-b border-border/40 bg-background py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={`local-port-section-${id}`}
      >
        <ChevronRight
          size={12}
          className={cn('shrink-0 transition-transform', !collapsed && 'rotate-90')}
        />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {ports.length > 0 && (
          <span className="text-[10px] text-muted-foreground/60 ml-1">{ports.length}</span>
        )}
      </button>
      {!collapsed && (
        <div id={`local-port-section-${id}`}>
          {ports.length > 0
            ? ports.map((port) => (
                <LocalPortRow
                  key={port.id}
                  port={port}
                  onStop={onStopPort}
                  onShowDetails={onShowDetails}
                  onOpenInBrowser={onOpenInBrowser}
                />
              ))
            : emptyText && <div className="py-1 text-xs text-muted-foreground">{emptyText}</div>}
        </div>
      )}
    </div>
  )
}

function LocalPortRow({
  port,
  onStop,
  onShowDetails,
  onOpenInBrowser
}: {
  port: WorkspacePort
  onStop: (port: WorkspacePort) => void
  onShowDetails: (port: WorkspacePort) => void
  onOpenInBrowser: (port: WorkspacePort, event?: React.MouseEvent<HTMLButtonElement>) => void
}): React.JSX.Element {
  const handleCopy = useCallback(() => {
    void window.api.ui.writeClipboardText(addressForPort(port))
  }, [port])

  const handleOpenBrowser = useCallback(
    (event?: React.MouseEvent<HTMLButtonElement>) => {
      void onOpenInBrowser(port, event)
    },
    [onOpenInBrowser, port]
  )

  const handleCopyButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      handleCopy()
      if (event.detail > 0) {
        event.currentTarget.blur()
      }
    },
    [handleCopy]
  )

  const handleOpenBrowserButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      // Why: keyboard activations have detail=0; only pointer clicks carry
      // the modifier intent for the system-browser escape hatch.
      handleOpenBrowser(event.detail > 0 ? event : undefined)
      if (event.detail > 0) {
        event.currentTarget.blur()
      }
    },
    [handleOpenBrowser]
  )

  const handleStopButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onStop(port)
      if (event.detail > 0) {
        event.currentTarget.blur()
      }
    },
    [onStop, port]
  )

  const processLabel = port.processName ?? (port.pid ? `PID ${port.pid}` : 'Unknown process')
  const address = addressForPort(port)
  const ownerLabel =
    port.kind === 'workspace'
      ? port.owner.displayName
      : port.kind === 'container'
        ? 'Container or forwarded service'
        : 'Unassigned'
  const openBrowserLabel = translate(
    'auto.components.right.sidebar.PortsPanel.b22b128b2a',
    'Open in Browser'
  )
  const confidenceLabel =
    port.kind === 'workspace' ? (port.owner.confidence === 'cwd' ? 'cwd' : 'command') : null
  const canStopProcess =
    port.kind === 'workspace' && Boolean(port.pid) && port.processName !== 'Electron'

  return (
    <ContextMenu>
      <div className="group flex items-center gap-2 py-1 px-1 -mx-1 rounded hover:bg-accent/50 transition-colors">
        <ContextMenuTrigger asChild>
          <div
            className="flex min-w-0 flex-1 items-center gap-2 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            tabIndex={0}
            aria-label={translate(
              'auto.components.right.sidebar.PortsPanel.5be4f7f727',
              'Port {{value0}} menu',
              { value0: port.port }
            )}
          >
            <div className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
              {port.kind === 'container' ? <Box size={13} /> : <Server size={13} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="text-xs font-medium text-foreground">:{port.port}</span>
                <span className="truncate text-xs text-muted-foreground">{processLabel}</span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="truncate">{address}</span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/70">
                <span className="truncate">{ownerLabel}</span>
                {confidenceLabel && (
                  <span className="shrink-0 text-muted-foreground/70">{confidenceLabel}</span>
                )}
              </div>
            </div>
          </div>
        </ContextMenuTrigger>
        <TooltipProvider delayDuration={400}>
          <div className="flex items-center gap-0.5 can-hover:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={handleOpenBrowserButtonClick}
                  aria-label={openBrowserLabel}
                >
                  <ExternalLink size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {getPortOpenBrowserTooltipLabel(openBrowserLabel)}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={handleCopyButtonClick}
                  aria-label={translate(
                    'auto.components.right.sidebar.PortsPanel.fe2730d050',
                    'Copy {{value0}}',
                    { value0: address }
                  )}
                >
                  <Copy size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {translate(
                  'auto.components.right.sidebar.PortsPanel.1004af16ab',
                  'Copy {{value0}}',
                  { value0: address }
                )}
              </TooltipContent>
            </Tooltip>
            {canStopProcess && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={handleStopButtonClick}
                    aria-label={translate(
                      'auto.components.right.sidebar.PortsPanel.f9528da632',
                      'Stop Process'
                    )}
                  >
                    <Trash2 size={13} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={4}>
                  {translate('auto.components.right.sidebar.PortsPanel.f9528da632', 'Stop Process')}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>
      </div>
      <ContextMenuContent className={LOCAL_PORT_MENU_CONTENT_CLASS}>
        <ContextMenuLabel
          className={LOCAL_PORT_MENU_LABEL_CLASS}
        >{`:${port.port}`}</ContextMenuLabel>
        <ContextMenuItem
          className={LOCAL_PORT_MENU_ITEM_CLASS}
          onSelect={() => handleOpenBrowser()}
        >
          <ExternalLink size={13} />
          {openBrowserLabel}
        </ContextMenuItem>
        <ContextMenuItem className={LOCAL_PORT_MENU_ITEM_CLASS} onSelect={handleCopy}>
          <Copy size={13} />
          {translate('auto.components.right.sidebar.PortsPanel.792baeb7ed', 'Copy Address')}
        </ContextMenuItem>
        <ContextMenuItem
          className={LOCAL_PORT_MENU_ITEM_CLASS}
          onSelect={() => {
            void window.api.ui.writeClipboardText(JSON.stringify(port, null, 2))
          }}
        >
          <Copy size={13} />
          {translate('auto.components.right.sidebar.PortsPanel.bdac206faf', 'Copy Details')}
        </ContextMenuItem>
        <ContextMenuItem
          className={LOCAL_PORT_MENU_ITEM_CLASS}
          onSelect={() => onShowDetails(port)}
        >
          <Info size={13} />
          {translate('auto.components.right.sidebar.PortsPanel.a223459512', 'Show Details')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className={LOCAL_PORT_MENU_ITEM_CLASS}
          variant="destructive"
          disabled={!canStopProcess}
          onSelect={() => onStop(port)}
        >
          <Trash2 size={13} />
          {translate('auto.components.right.sidebar.PortsPanel.f9528da632', 'Stop Process')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function LocalPortDetailsDialog({
  port,
  onClose
}: {
  port: WorkspacePort | null
  onClose: () => void
}): React.JSX.Element {
  return (
    <Dialog open={Boolean(port)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {port
              ? translate(
                  'auto.components.right.sidebar.PortsPanel.472054d94c',
                  'Port :{{value0}}',
                  { value0: port.port }
                )
              : translate('auto.components.right.sidebar.PortsPanel.d41a8241ec', 'Port')}
          </DialogTitle>
          <DialogDescription>
            {port ? `${port.processName ?? 'Unknown process'} · ${addressForPort(port)}` : ''}
          </DialogDescription>
        </DialogHeader>
        {port && (
          <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-xs">
            <dt className="text-muted-foreground">
              {translate('auto.components.right.sidebar.PortsPanel.1c1c18cefc', 'Address')}
            </dt>
            <dd className="min-w-0 break-all text-foreground">{addressForPort(port)}</dd>
            <dt className="text-muted-foreground">
              {translate('auto.components.right.sidebar.PortsPanel.0f1d8cd324', 'Bind')}
            </dt>
            <dd className="min-w-0 break-all text-foreground">{`${port.bindHost}:${port.port}`}</dd>
            <dt className="text-muted-foreground">
              {translate('auto.components.right.sidebar.PortsPanel.729be0b4e5', 'Kind')}
            </dt>
            <dd className="text-foreground">{port.kind}</dd>
            <dt className="text-muted-foreground">
              {translate('auto.components.right.sidebar.PortsPanel.b1ff94fa27', 'Protocol')}
            </dt>
            <dd className="text-foreground">{port.protocol}</dd>
            <dt className="text-muted-foreground">
              {translate('auto.components.right.sidebar.PortsPanel.5dd86dcf2f', 'Process')}
            </dt>
            <dd className="min-w-0 break-all text-foreground">
              {port.processName ??
                translate('auto.components.right.sidebar.PortsPanel.3e13cb63ee', 'Unknown')}
            </dd>
            <dt className="text-muted-foreground">
              {translate('auto.components.right.sidebar.PortsPanel.57d930fa45', 'PID')}
            </dt>
            <dd className="text-foreground">
              {port.pid ??
                translate('auto.components.right.sidebar.PortsPanel.3e13cb63ee', 'Unknown')}
            </dd>
            {port.kind === 'workspace' && (
              <>
                <dt className="text-muted-foreground">
                  {translate('auto.components.right.sidebar.PortsPanel.c7b4702b7b', 'Workspace')}
                </dt>
                <dd className="min-w-0 break-all text-foreground">{port.owner.displayName}</dd>
                <dt className="text-muted-foreground">
                  {translate('auto.components.right.sidebar.PortsPanel.153145e675', 'Evidence')}
                </dt>
                <dd className="text-foreground">{port.owner.confidence}</dd>
              </>
            )}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  )
}
