import { useEffect, useState, type JSX } from 'react'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge
} from '../../web/codev-bridge'
import {
  CodevSharedSessionViewPanel,
  type CodevSharedSessionSnapshot,
  type CodevSharedSessionView
} from './CodevSharedSessionView'

export {
  CodevSharedSessionViewPanel,
  type CodevSharedQueueEntry,
  type CodevSharedSessionSnapshot,
  type CodevSharedSessionView,
  type CodevSharedTranscriptTurn
} from './CodevSharedSessionView'

function pickSession(
  sessions: CodevSharedSessionView[],
  selectedId: string | null
): CodevSharedSessionView | null {
  if (sessions.length === 0) return null
  return (
    sessions.find((session) => session.session.sessionId === selectedId) ??
    sessions[sessions.length - 1] ??
    null
  )
}

export function CodevSharedSessionPanel({
  refreshToken = 0
}: {
  refreshToken?: number
}): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
  const [snapshot, setSnapshot] = useState(() => getCodevBridgeSnapshot())
  const [viewer, setViewer] = useState<{ id: string; name: string; canCoSteer: boolean } | null>(
    null
  )
  const [sessions, setSessions] = useState<CodevSharedSessionView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftPrompt, setDraftPrompt] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    return subscribeCodevBridge(() => {
      setSnapshot(getCodevBridgeSnapshot())
    })
  }, [])

  useEffect(() => {
    if (!embedded || snapshot.status !== 'connected') return
    let cancelled = false
    setBusy('refresh')
    void requestCodevBridge<CodevSharedSessionSnapshot>('agents.list')
      .then((result) => {
        if (cancelled) return
        const nextSessions = result.sharedSessions ?? []
        setViewer(result.viewer ?? null)
        setSessions(nextSessions)
        setSelectedId((current) => pickSession(nextSessions, current)?.session.sessionId ?? null)
        setRestored(
          nextSessions.some(
            (session) =>
              session.session.streamCursor > 0 ||
              session.session.queue.length > 0 ||
              session.transcript.length > 0
          )
        )
        setMessage('')
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : 'CoDev could not load shared sessions.')
        }
      })
      .finally(() => {
        if (!cancelled) setBusy('')
      })
    return () => {
      cancelled = true
    }
  }, [embedded, snapshot.status, refreshToken])

  if (!embedded) return null

  const view = pickSession(sessions, selectedId)
  const sessionId = view?.session.sessionId

  async function applySnapshot(result: CodevSharedSessionSnapshot): Promise<void> {
    const nextSessions = result.sharedSessions ?? []
    setViewer(result.viewer ?? null)
    setSessions(nextSessions)
    setSelectedId((current) => pickSession(nextSessions, current)?.session.sessionId ?? null)
  }

  async function run(
    action: string,
    request: () => Promise<CodevSharedSessionSnapshot>
  ): Promise<void> {
    if (!sessionId) return
    setBusy(action)
    setMessage('')
    try {
      await applySnapshot(await request())
      setRestored(false)
      if (action === 'queue') setDraftPrompt('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'CoDev could not update the shared session.')
    } finally {
      setBusy('')
    }
  }

  return (
    <CodevSharedSessionViewPanel
      connected={snapshot.status === 'connected'}
      restored={restored}
      viewer={viewer}
      view={view}
      draftPrompt={draftPrompt}
      busy={busy}
      message={message}
      onDraftChange={setDraftPrompt}
      onRefresh={() => {
        setBusy('refresh')
        void requestCodevBridge<CodevSharedSessionSnapshot>('agents.list')
          .then((result) => {
            void applySnapshot(result)
            setRestored(true)
            setMessage('')
          })
          .catch((error: unknown) => {
            setMessage(
              error instanceof Error ? error.message : 'CoDev could not load shared sessions.'
            )
          })
          .finally(() => setBusy(''))
      }}
      onStartControlled={() =>
        void run('controlled', () =>
          requestCodevBridge<CodevSharedSessionSnapshot>('agents.startControlled', { sessionId })
        )
      }
      onQueue={() =>
        void run('queue', () =>
          requestCodevBridge<CodevSharedSessionSnapshot>('agents.enqueue', {
            sessionId,
            prompt: draftPrompt
          })
        )
      }
      onInterrupt={() =>
        void run('interrupt', () =>
          requestCodevBridge<CodevSharedSessionSnapshot>('agents.interrupt', { sessionId })
        )
      }
      onSelectProvider={(provider) =>
        void run('provider', () =>
          requestCodevBridge<CodevSharedSessionSnapshot>('agents.selectProvider', {
            sessionId,
            provider
          })
        )
      }
    />
  )
}
