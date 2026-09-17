import { useCallback, useEffect, useRef, useState } from 'react'
import type { CodevWorkboardSnapshot } from '../sidebar/CodevWorkboardView'
import type {
  CodevSharedSessionView,
  CodevSharedSessionSnapshot
} from '../right-sidebar/codev-shared-session-model'
import { publishCodevWorkboard } from '../sidebar/codev-workboard-store'
import {
  getCodevBridgeSnapshot,
  reconnectCodevBridge,
  requestCodevBridge,
  subscribeCodevBridge
} from '@/web/codev-bridge-singleton'
import type { TeamRoster } from './codev-team-shared'

const BRANCH_REFRESH_MS = 5_000
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
  const inFlightRef = useRef(false)

  useEffect(() => subscribeCodevBridge(() => setBridge(getCodevBridgeSnapshot())), [])

  const refresh = useCallback(async () => {
    if (!active || getCodevBridgeSnapshot().status !== 'connected' || inFlightRef.current) {
      return
    }
    inFlightRef.current = true
    setRefreshing(true)
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
    inFlightRef.current = false
    setRefreshing(false)
  }, [active])

  useEffect(() => {
    if (!active || bridge.status !== 'connected') {
      return
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), BRANCH_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [active, bridge.status, refresh])

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
