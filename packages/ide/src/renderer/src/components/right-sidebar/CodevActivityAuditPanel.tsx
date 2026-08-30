import { useCallback, useEffect, useState, type JSX } from 'react'
import { useAppStore } from '@/store'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge
} from '../../web/codev-bridge'
import {
  CodevActivityAuditViewPanel,
  type CodevActivityEvent,
  type CodevActivityJumpKind,
  type CodevActivitySnapshot
} from './CodevActivityAuditView'

export { CodevActivityAuditViewPanel, type CodevActivitySnapshot } from './CodevActivityAuditView'

export function CodevActivityAuditPanel(): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
  const setRightSidebarTab = useAppStore((s) => s.setRightSidebarTab)
  const [bridge, setBridge] = useState(() => getCodevBridgeSnapshot())
  const [snapshot, setSnapshot] = useState<CodevActivitySnapshot | null>(null)
  const [kind, setKind] = useState<'all' | CodevActivityJumpKind>('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')
  const [jumped, setJumped] = useState('')

  useEffect(() => {
    return subscribeCodevBridge(() => {
      setBridge(getCodevBridgeSnapshot())
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!embedded || bridge.status !== 'connected') return
    setBusy('refresh')
    try {
      const result = await requestCodevBridge<CodevActivitySnapshot>('activity.list')
      setSnapshot(result)
    } catch (error: unknown) {
      setSnapshot(null)
      setJumped(error instanceof Error ? error.message : 'CoDev could not load workspace activity.')
    } finally {
      setBusy('')
    }
  }, [bridge.status, embedded])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!embedded) return null

  function jump(event: CodevActivityEvent): void {
    if (!event.jump) return
    setRightSidebarTab(event.jump.surface)
    const surfaceLabel =
      event.jump.surface === 'explorer'
        ? 'Explorer'
        : event.jump.surface === 'vault'
          ? 'Agents'
          : 'Checks'
    setJumped(`Jumped to ${surfaceLabel} · ${event.type}`)
  }

  return (
    <CodevActivityAuditViewPanel
      connected={bridge.status === 'connected'}
      snapshot={snapshot}
      kind={kind}
      query={query}
      busy={busy}
      jumped={jumped}
      onKindChange={setKind}
      onQueryChange={setQuery}
      onRefresh={() => {
        void refresh()
      }}
      onJump={jump}
    />
  )
}
