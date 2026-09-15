import { useCallback, useEffect, useState, type JSX } from 'react'
import { toast } from 'sonner'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge
} from '../../web/codev-bridge-singleton'
import { startCodevManagedAgent } from '../../web/codev-managed-agent'
import { publishCodevWorkboard, setCodevWorkboardStartSession } from './codev-workboard-store'
import { publishCodevPathClaims } from './codev-path-claims-store'
import type { CodevPathClaimsSnapshot } from './CodevPathClaimsView'
import {
  CodevWorkboardViewPanel,
  type CodevWorkboardCapacity,
  type CodevWorkboardRejection,
  type CodevWorkboardSlot,
  type CodevWorkboardSnapshot
} from './CodevWorkboardView'

export {
  CodevWorkboardViewPanel,
  type CodevWorkboardSnapshot,
  type CodevWorkboardSlot
} from './CodevWorkboardView'

function applySnapshot(result: CodevWorkboardSnapshot): {
  slots: CodevWorkboardSlot[]
  capacity: CodevWorkboardCapacity | null
  rejection: CodevWorkboardRejection | null
  canCoSteer: boolean
} {
  publishCodevWorkboard(result)
  return {
    slots: result.slots ?? [],
    capacity: result.capacity ?? null,
    rejection: result.rejection ?? null,
    canCoSteer: Boolean(result.viewer?.canCoSteer)
  }
}

export function CodevWorkboardPanel({ open }: { open: boolean }): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
  const [snapshot, setSnapshot] = useState(() => getCodevBridgeSnapshot())
  const [slots, setSlots] = useState<CodevWorkboardSlot[]>([])
  const [capacity, setCapacity] = useState<CodevWorkboardCapacity | null>(null)
  const [rejection, setRejection] = useState<CodevWorkboardRejection | null>(null)
  const [canCoSteer, setCanCoSteer] = useState(false)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    return subscribeCodevBridge(() => {
      setSnapshot(getCodevBridgeSnapshot())
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!embedded || snapshot.status !== 'connected') {
      return
    }
    setBusy('refresh')
    try {
      const result = await requestCodevBridge<CodevWorkboardSnapshot>('workboard.list')
      const next = applySnapshot(result)
      setSlots(next.slots)
      setCapacity(next.capacity)
      setCanCoSteer(next.canCoSteer)
      if (!next.rejection) {
        setRejection(null)
      }
      try {
        publishCodevPathClaims(await requestCodevBridge<CodevPathClaimsSnapshot>('claims.list'))
      } catch {
        // Why: workboard still renders if claims are unavailable; Explorer retries independently.
      }
    } catch (error: unknown) {
      toast.error('Failed to load workboard', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy('')
    }
  }, [embedded, snapshot.status])

  useEffect(() => {
    if (!open || !embedded || snapshot.status !== 'connected') {
      return
    }
    void refresh()
  }, [embedded, open, refresh, snapshot.status])

  const startSession = useCallback(async () => {
    if (!embedded || snapshot.status !== 'connected') {
      return
    }
    setBusy('create')
    try {
      await startCodevManagedAgent()
      await refresh()
      toast.success('CoDev agent started', {
        description: 'Orca is now showing the managed agent workspace.'
      })
    } catch (error: unknown) {
      toast.error('Failed to start agent session', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy('')
    }
  }, [embedded, refresh, snapshot.status])

  useEffect(() => {
    setCodevWorkboardStartSession(startSession)
    return () => setCodevWorkboardStartSession(null)
  }, [startSession])

  if (!embedded) {
    return null
  }

  return (
    <CodevWorkboardViewPanel
      connected={snapshot.status === 'connected'}
      capacity={capacity}
      slots={slots}
      rejection={rejection}
      busy={busy}
      canCoSteer={canCoSteer}
      onRefresh={() => {
        void refresh()
      }}
      onStart={() => {
        void startSession()
      }}
    />
  )
}
