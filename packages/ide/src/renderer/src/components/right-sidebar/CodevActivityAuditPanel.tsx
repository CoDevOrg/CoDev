import { useCallback, useEffect, useState, type JSX } from 'react'
import { useAppStore } from '@/store'
import { useActiveWorktree } from '@/store/selectors'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { requestCodevSurfaceFocus } from '@/web/codev-surface-focus'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge
} from '../../web/codev-bridge-singleton'
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
  const openFile = useAppStore((s) => s.openFile)
  const revealInExplorer = useAppStore((s) => s.revealInExplorer)
  const activeWorktree = useActiveWorktree()
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
    if (!embedded || bridge.status !== 'connected') {
      return
    }
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

  if (!embedded) {
    return null
  }

  /**
   * A jump lands on the event's target, not just its surface. It used to
   * switch the sidebar tab and stop, leaving the member to find the file,
   * session or checkpoint again by hand.
   */
  function jump(event: CodevActivityEvent): void {
    const target = event.jump
    if (!target) {
      return
    }
    if (target.kind === 'file') {
      if (!target.path) {
        setJumped('This event does not name a file to open.')
        return
      }
      if (!activeWorktree?.path) {
        setJumped('Open a checkout to jump to its files.')
        return
      }
      const filePath = joinPath(activeWorktree.path, target.path)
      openFile({
        filePath,
        relativePath: target.path,
        worktreeId: activeWorktree.id,
        language: detectLanguage(target.path),
        mode: 'edit'
      })
      revealInExplorer(activeWorktree.id, filePath)
      setJumped(`Opened ${target.path}`)
      return
    }
    if (target.kind === 'session') {
      if (!target.sessionId) {
        setJumped('This event does not name a session to open.')
        return
      }
      // Mission Control is where a session lives in CoDev; the drawer for it
      // opens once the panel has the row.
      setRightSidebarTab('codev-agents')
      requestCodevSurfaceFocus({ kind: 'mission-control-agent', sessionId: target.sessionId })
      setJumped('Opened Mission Control · session')
      return
    }
    setRightSidebarTab('checks')
    if (target.sessionId) {
      requestCodevSurfaceFocus({ kind: 'review-checkpoint', sessionId: target.sessionId })
    }
    setJumped(target.path ? `Opened Checks · ${target.path}` : 'Opened Checks · checkpoint')
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
