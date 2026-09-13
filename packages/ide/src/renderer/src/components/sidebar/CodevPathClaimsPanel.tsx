import { useCallback, useEffect, useState, type JSX } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useActiveWorktree } from '@/store/selectors'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge
} from '../../web/codev-bridge-singleton'
import { publishCodevPathClaims } from './codev-path-claims-store'
import {
  CodevPathClaimsViewPanel,
  targetPathClaimGroup,
  type CodevPathClaimsSnapshot
} from './CodevPathClaimsView'

export { CodevPathClaimsViewPanel, type CodevPathClaimsSnapshot } from './CodevPathClaimsView'

function applySnapshot(result: CodevPathClaimsSnapshot): CodevPathClaimsSnapshot {
  publishCodevPathClaims(result)
  return result
}

export function CodevPathClaimsPanel(): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
  const [bridge, setBridge] = useState(() => getCodevBridgeSnapshot())
  const [snapshot, setSnapshot] = useState<CodevPathClaimsSnapshot | null>(null)
  const [busy, setBusy] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  // The claim is for the file in front of the member, in the checkout they
  // are in — not a default path the backend happens to share.
  const activeWorktree = useActiveWorktree()
  const activeFileId = useAppStore((s) => s.activeFileId)
  const openFiles = useAppStore((s) => s.openFiles)

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
      const result = await requestCodevBridge<CodevPathClaimsSnapshot>('claims.list')
      setSnapshot(applySnapshot(result))
    } catch (error: unknown) {
      toast.error('Failed to load path claims', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy('')
    }
  }, [bridge.status, embedded])

  useEffect(() => {
    if (!embedded || bridge.status !== 'connected') {
      return
    }
    void refresh()
  }, [bridge.status, embedded, refresh])

  const run = useCallback(
    async (busyKey: string, action: () => Promise<CodevPathClaimsSnapshot>) => {
      setBusy(busyKey)
      try {
        setSnapshot(applySnapshot(await action()))
      } catch (error: unknown) {
        toast.error('Path claim failed', {
          description: error instanceof Error ? error.message : String(error)
        })
      } finally {
        setBusy('')
      }
    },
    []
  )

  if (!embedded) {
    return null
  }

  const slots = (snapshot?.slots ?? []).filter((slot) => slot.occupied && slot.sessionId)
  const activeFile = activeFileId
    ? (openFiles.find((file) => file.id === activeFileId) ?? null)
    : null
  const targetPath =
    activeFile && activeWorktree && activeFile.worktreeId === activeWorktree.id
      ? activeFile.relativePath
      : null
  const agent = slots.find((slot) => slot.sessionId === selectedSessionId) ?? slots[0] ?? null
  const otherAgent = slots.find((slot) => slot.sessionId !== agent?.sessionId) ?? null
  const group = targetPathClaimGroup(snapshot?.groups ?? [], targetPath)
  const canCoSteer = Boolean(snapshot?.viewer?.canCoSteer)

  return (
    <CodevPathClaimsViewPanel
      connected={bridge.status === 'connected'}
      snapshot={snapshot}
      targetPath={targetPath}
      agentSessionId={agent?.sessionId ?? null}
      onSelectAgent={setSelectedSessionId}
      busy={busy}
      canCoSteer={canCoSteer}
      onRefresh={() => {
        void refresh()
      }}
      onClaim={() => {
        const sessionId = agent?.sessionId
        if (!sessionId || !targetPath) {
          return
        }
        void run('create', () =>
          requestCodevBridge<CodevPathClaimsSnapshot>('claims.create', {
            sessionId,
            path: targetPath
          })
        )
      }}
      onOverlap={() => {
        const sessionId = otherAgent?.sessionId
        if (!sessionId || !targetPath) {
          return
        }
        void run('overlap', () =>
          requestCodevBridge<CodevPathClaimsSnapshot>('claims.create', {
            sessionId,
            path: targetPath,
            contest: true
          })
        )
      }}
      onReassign={() => {
        const claimId = group?.reassignClaimId
        if (!claimId) {
          return
        }
        void run('reassign', () =>
          requestCodevBridge<CodevPathClaimsSnapshot>('claims.reassign', { claimId })
        )
      }}
      onCancel={() => {
        const claimId = group?.overlappingClaimId
        if (!claimId) {
          return
        }
        void run('cancel', () =>
          requestCodevBridge<CodevPathClaimsSnapshot>('claims.cancel', { claimId })
        )
      }}
    />
  )
}
