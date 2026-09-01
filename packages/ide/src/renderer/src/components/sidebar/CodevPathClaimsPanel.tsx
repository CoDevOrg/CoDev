import { useCallback, useEffect, useState, type JSX } from 'react'
import { toast } from 'sonner'
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

  useEffect(() => {
    return subscribeCodevBridge(() => {
      setBridge(getCodevBridgeSnapshot())
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!embedded || bridge.status !== 'connected') return
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
    if (!embedded || bridge.status !== 'connected') return
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
  const group = targetPathClaimGroup(snapshot?.groups ?? [], snapshot?.defaultPath)
  const canCoSteer = Boolean(snapshot?.viewer?.canCoSteer)

  return (
    <CodevPathClaimsViewPanel
      connected={bridge.status === 'connected'}
      snapshot={snapshot}
      busy={busy}
      canCoSteer={canCoSteer}
      onRefresh={() => {
        void refresh()
      }}
      onClaim={() => {
        const sessionId = slots[0]?.sessionId
        if (!sessionId) return
        void run('create', () =>
          requestCodevBridge<CodevPathClaimsSnapshot>('claims.create', { sessionId })
        )
      }}
      onOverlap={() => {
        const sessionId = slots[1]?.sessionId
        if (!sessionId) return
        void run('overlap', () =>
          requestCodevBridge<CodevPathClaimsSnapshot>('claims.create', {
            sessionId,
            contest: true
          })
        )
      }}
      onReassign={() => {
        const claimId = group?.reassignClaimId
        if (!claimId) return
        void run('reassign', () =>
          requestCodevBridge<CodevPathClaimsSnapshot>('claims.reassign', { claimId })
        )
      }}
      onCancel={() => {
        const claimId = group?.overlappingClaimId
        if (!claimId) return
        void run('cancel', () =>
          requestCodevBridge<CodevPathClaimsSnapshot>('claims.cancel', { claimId })
        )
      }}
    />
  )
}
