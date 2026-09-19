import { useCallback, useEffect, useRef, useState } from 'react'
import type { CodevWorkboardSnapshot } from '../sidebar/CodevWorkboardView'
import type {
  CodevSharedSessionView,
  CodevSharedSessionSnapshot
} from '../right-sidebar/codev-shared-session-model'
import { publishCodevWorkboard } from '../sidebar/codev-workboard-store'
import {
  getCodevBridgeSnapshot,
  getCodevWorkspaceStreamStatus,
  reconnectCodevBridge,
  requestCodevBridge,
  subscribeCodevBridge,
  subscribeCodevWorkspaceEvent,
  subscribeCodevWorkspaceStream
} from '@/web/codev-bridge-singleton'
import type { CodevWorkspaceStreamStatus } from '@/web/codev-bridge-singleton'
import type { TeamRoster } from './codev-team-shared'

const BRANCH_FALLBACK_REFRESH_MS = 15_000
const DISCONNECTED_BRIDGE = {
  status: 'disconnected' as const,
  label: 'CoDev · Disconnected',
  detail: 'Workspace-bound request bridge is interrupted.'
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export function useCodevBranchPresence(active: boolean): {
  bridge: ReturnType<typeof getCodevBridgeSnapshot>
  workboard: CodevWorkboardSnapshot | null
  roster: TeamRoster | null
  workboardError: string | null
  sharedSessions: CodevSharedSessionView[] | null
  sharedSessionsError: string | null
  workboardErrorAt: number | null
  sharedSessionsErrorAt: number | null
  rosterError: string | null
  refreshing: boolean
  refresh: () => Promise<void>
  retry: () => void
} {
  const [bridge, setBridge] = useState(() =>
    typeof window === 'undefined' ? DISCONNECTED_BRIDGE : getCodevBridgeSnapshot()
  )
  const [workboard, setWorkboard] = useState<CodevWorkboardSnapshot | null>(null)
  const [roster, setRoster] = useState<TeamRoster | null>(null)
  const [workboardError, setWorkboardError] = useState<string | null>(null)
  const [sharedSessions, setSharedSessions] = useState<CodevSharedSessionView[] | null>(null)
  const [sharedSessionsError, setSharedSessionsError] = useState<string | null>(null)
  const [workboardErrorAt, setWorkboardErrorAt] = useState<number | null>(null)
  const [sharedSessionsErrorAt, setSharedSessionsErrorAt] = useState<number | null>(null)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [workspaceStreamStatus, setWorkspaceStreamStatus] = useState<CodevWorkspaceStreamStatus>(
    () => (typeof window === 'undefined' ? 'unavailable' : getCodevWorkspaceStreamStatus())
  )
  const inFlightRef = useRef(false)
  const queuedRefreshRef = useRef(false)
  const activeRef = useRef(active)

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => subscribeCodevBridge(() => setBridge(getCodevBridgeSnapshot())), [])

  const refresh = useCallback(async () => {
    if (!active || getCodevBridgeSnapshot().status !== 'connected') {
      return
    }
    if (inFlightRef.current) {
      // Realtime events are invalidations, not durable payloads. If one lands
      // during a refresh, remember it so the latest snapshot is fetched after
      // the current request completes instead of silently losing the update.
      queuedRefreshRef.current = true
      return
    }
    inFlightRef.current = true
    setRefreshing(true)
    try {
      const [workboardResult, sessionsResult, rosterResult] = await Promise.allSettled([
        requestCodevBridge<CodevWorkboardSnapshot>('workboard.list'),
        requestCodevBridge<CodevSharedSessionSnapshot>('agents.list'),
        requestCodevBridge<TeamRoster>('team.roster')
      ])

      if (workboardResult.status === 'fulfilled') {
        setWorkboard(workboardResult.value)
        setWorkboardError(null)
        setWorkboardErrorAt(null)
        publishCodevWorkboard(workboardResult.value)
      } else {
        setWorkboardError(errorMessage(workboardResult.reason, 'Branch status is unavailable.'))
        setWorkboardErrorAt((current) => current ?? Date.now())
      }
      if (sessionsResult.status === 'fulfilled') {
        setSharedSessions(sessionsResult.value.sharedSessions ?? [])
        setSharedSessionsError(null)
        setSharedSessionsErrorAt(null)
      } else {
        setSharedSessionsError(errorMessage(sessionsResult.reason, 'Agent status is unavailable.'))
        setSharedSessionsErrorAt((current) => current ?? Date.now())
      }
      if (rosterResult.status === 'fulfilled') {
        setRoster(rosterResult.value)
        setRosterError(null)
      } else {
        setRosterError(errorMessage(rosterResult.reason, 'Branch ownership is unavailable.'))
      }
    } finally {
      inFlightRef.current = false
      setRefreshing(false)
      if (queuedRefreshRef.current) {
        queuedRefreshRef.current = false
        if (activeRef.current && getCodevBridgeSnapshot().status === 'connected') {
          window.setTimeout(() => void refresh(), 0)
        }
      }
    }
  }, [active])

  useEffect(() => {
    const unsubscribeEvent = subscribeCodevWorkspaceEvent((event) => {
      if (
        event.type === 'agents.changed' ||
        event.type === 'coordination.changed' ||
        event.type === 'team.changed' ||
        event.type === 'presence.changed'
      ) {
        void refresh()
      }
    })
    const unsubscribeStream = subscribeCodevWorkspaceStream(setWorkspaceStreamStatus)
    return () => {
      unsubscribeEvent()
      unsubscribeStream()
    }
  }, [refresh])

  useEffect(() => {
    if (!active || bridge.status !== 'connected') {
      return
    }
    void refresh()
    if (workspaceStreamStatus === 'connected') {
      return
    }
    const timer = window.setInterval(() => void refresh(), BRANCH_FALLBACK_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [active, bridge.status, refresh, workspaceStreamStatus])

  const retry = useCallback(() => {
    if (getCodevBridgeSnapshot().status !== 'connected') {
      reconnectCodevBridge()
      return
    }
    void refresh()
  }, [refresh])

  return {
    bridge,
    workboard,
    roster,
    workboardError,
    sharedSessions,
    sharedSessionsError,
    workboardErrorAt,
    sharedSessionsErrorAt,
    rosterError,
    refreshing,
    refresh,
    retry
  }
}
