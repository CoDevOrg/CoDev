import { Loader2, Radio } from 'lucide-react'
import { useEffect, useSyncExternalStore, type JSX } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  getCodevBridgeSnapshot,
  interruptCodevBridge,
  reconnectCodevBridge,
  startCodevBridge,
  subscribeCodevBridge,
  type CodevBridgeSnapshot
} from '@/web/codev-bridge'

function statusDotClass(status: CodevBridgeSnapshot['status']): string {
  if (status === 'connected') {
    return 'bg-emerald-500'
  }
  if (status === 'reconnecting') {
    return 'bg-yellow-500'
  }
  return 'bg-muted-foreground/40'
}

export function CodevBridgeStatusView({
  snapshot,
  compact,
  iconOnly,
  onInterrupt,
  onReconnect
}: {
  snapshot: CodevBridgeSnapshot
  compact: boolean
  iconOnly: boolean
  onInterrupt: () => void
  onReconnect: () => void
}): JSX.Element {
  const actionLabel =
    snapshot.status === 'connected'
      ? 'Disconnect'
      : snapshot.status === 'disconnected'
        ? 'Reconnect'
        : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 cursor-pointer rounded px-1 py-0.5 hover:bg-accent/70"
          aria-label={`CoDev bridge connection status: ${snapshot.status === 'connected' ? 'Connected' : snapshot.status === 'reconnecting' ? 'Reconnecting' : 'Disconnected'}`}
        >
          {iconOnly ? (
            <span className="inline-flex items-center gap-1">
              {snapshot.status === 'reconnecting' ? (
                <Loader2 className="size-3 animate-spin text-yellow-500" />
              ) : (
                <Radio className="size-3 text-muted-foreground" />
              )}
              <span className={`inline-block size-1.5 rounded-full ${statusDotClass(snapshot.status)}`} />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              {snapshot.status === 'reconnecting' ? (
                <Loader2 className="size-3 animate-spin text-yellow-500" />
              ) : (
                <Radio
                  className={`size-3 ${snapshot.status === 'connected' ? 'text-emerald-500' : 'text-muted-foreground'}`}
                />
              )}
              {!compact ? (
                <span className="text-[11px] text-muted-foreground">{snapshot.label}</span>
              ) : null}
              <span className={`inline-block size-1.5 rounded-full ${statusDotClass(snapshot.status)}`} />
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-72 p-1">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <span className={`size-1.5 shrink-0 rounded-full ${statusDotClass(snapshot.status)}`} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium">CoDev</div>
            <div className="truncate text-[10px] text-muted-foreground">{snapshot.detail}</div>
          </div>
          {actionLabel ? (
            <button
              type="button"
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent/70 hover:text-foreground"
              onClick={() => {
                if (snapshot.status === 'connected') {
                  onInterrupt()
                  return
                }
                onReconnect()
              }}
            >
              {actionLabel}
            </button>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CodevBridgeStatusSegment({
  compact,
  iconOnly
}: {
  compact: boolean
  iconOnly: boolean
}): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
  const snapshot = useSyncExternalStore(
    subscribeCodevBridge,
    getCodevBridgeSnapshot,
    getCodevBridgeSnapshot
  )
  useEffect(() => {
    if (embedded) {
      startCodevBridge()
    }
  }, [embedded])
  if (!embedded) {
    return null
  }
  return (
    <CodevBridgeStatusView
      snapshot={snapshot}
      compact={compact}
      iconOnly={iconOnly}
      onInterrupt={interruptCodevBridge}
      onReconnect={reconnectCodevBridge}
    />
  )
}
