import { useEffect, useEffectEvent, useRef, useState, type JSX } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type SessionView = {
  id: string
  status: 'starting' | 'awaiting_code' | 'exchanging' | 'connected' | 'failed'
  authorizeUrl: string | null
  failureReason: string | null
}

type Phase = 'idle' | 'starting' | 'awaiting_code' | 'polling' | 'failed'

const BASE = '/api/personal/claude-connection/session'
const POLL_MS = 2_000

function deleteSession(id: string): void {
  void fetch(`${BASE}/${id}`, { method: 'DELETE', keepalive: true, credentials: 'include' }).catch(
    () => {}
  )
}

export function CodevHostedClaudeConnect({
  connected,
  onConnected
}: {
  connected: boolean
  onConnected: () => void
}): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('idle')
  const [session, setSession] = useState<SessionView | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const attempt = useRef(0)
  const submittingRef = useRef(false)
  const sessionRef = useRef<SessionView | null>(null)
  const notifyConnected = useEffectEvent(onConnected)
  const activeSessionId =
    !connected && (phase === 'awaiting_code' || phase === 'polling') ? session?.id : undefined

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(
    () => () => {
      attempt.current += 1
      if (sessionRef.current) {
        deleteSession(sessionRef.current.id)
      }
    },
    []
  )

  useEffect(() => {
    if (!activeSessionId) {
      return
    }
    const sessionId = activeSessionId
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll(): Promise<void> {
      if (submittingRef.current) {
        timer = setTimeout(() => void poll(), POLL_MS)
        return
      }
      try {
        const response = await fetch(`${BASE}/${sessionId}`, {
          signal: controller.signal,
          credentials: 'include'
        })
        const payload = (await response.json().catch(() => ({}))) as
          | SessionView
          | { error?: string }
        if (controller.signal.aborted) {
          return
        }
        if (!response.ok || !('status' in payload)) {
          throw new Error(('error' in payload && payload.error) || 'Lost the connection attempt.')
        }
        if (payload.status === 'connected') {
          attempt.current += 1
          setSession(null)
          setCode('')
          setError('')
          setSubmitting(false)
          submittingRef.current = false
          setPhase('idle')
          notifyConnected()
          return
        }
        if (payload.status === 'failed') {
          throw new Error(payload.failureReason ?? 'The connection attempt failed.')
        }
        if (payload.status === 'exchanging') {
          setPhase('polling')
        }
        timer = setTimeout(() => void poll(), POLL_MS)
      } catch (caught) {
        if (controller.signal.aborted) {
          return
        }
        attempt.current += 1
        setSubmitting(false)
        submittingRef.current = false
        setPhase('failed')
        setError(caught instanceof Error ? caught.message : 'Lost the connection attempt.')
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [activeSessionId])

  function reset(): void {
    attempt.current += 1
    if (session) {
      deleteSession(session.id)
    }
    setSession(null)
    setCode('')
    setError('')
    setSubmitting(false)
    submittingRef.current = false
    setPhase('idle')
  }

  async function start(): Promise<void> {
    const currentAttempt = ++attempt.current
    setPhase('starting')
    setError('')
    try {
      const response = await fetch(BASE, { method: 'POST', credentials: 'include' })
      const payload = (await response.json().catch(() => ({}))) as SessionView | { error?: string }
      if (attempt.current !== currentAttempt) {
        return
      }
      if (!response.ok || !('id' in payload)) {
        setPhase('failed')
        setError(('error' in payload && payload.error) || 'Claude connect could not start.')
        return
      }
      setSession(payload)
      setPhase('awaiting_code')
      if (payload.authorizeUrl) {
        window.open(payload.authorizeUrl, '_blank', 'noopener,noreferrer')
      }
    } catch {
      if (attempt.current !== currentAttempt) {
        return
      }
      setPhase('failed')
      setError('Could not reach CoDev. Check your connection and try again.')
    }
  }

  async function submit(): Promise<void> {
    if (!session || !code.trim() || submitting) {
      return
    }
    const currentAttempt = attempt.current
    setSubmitting(true)
    submittingRef.current = true
    setError('')
    try {
      const response = await fetch(`${BASE}/${session.id}/code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code.trim() })
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (attempt.current !== currentAttempt) {
        return
      }
      if (!response.ok) {
        setError(payload.error ?? 'That code was not accepted.')
        return
      }
      setPhase('polling')
      setCode('')
    } catch {
      if (attempt.current !== currentAttempt) {
        return
      }
      setError('Could not submit the code. Check your connection and try again.')
    } finally {
      if (attempt.current === currentAttempt) {
        setSubmitting(false)
      }
      submittingRef.current = false
    }
  }

  if (connected) {
    return null
  }

  if (phase === 'idle') {
    return (
      <Button className="mt-4 min-h-11" onClick={() => void start()} size="sm" type="button">
        Connect Claude
      </Button>
    )
  }

  return (
    <div className="mt-4 space-y-3 rounded-md border border-border bg-background/60 p-4">
      {phase === 'starting' ? (
        <p className="text-xs text-muted-foreground" role="status">
          Starting…
        </p>
      ) : null}
      {phase === 'awaiting_code' && session ? (
        <>
          <p className="text-xs text-muted-foreground">
            Approve access on the Claude tab. CoDev will connect automatically when authorization
            finishes. If Claude gives you a code, paste it below.
          </p>
          <a
            className="inline-flex min-h-11 items-center text-sm text-foreground underline focus-visible:outline-2 focus-visible:outline-ring"
            href={session.authorizeUrl ?? '#'}
            rel="noreferrer"
            target="_blank"
          >
            Reopen Claude authorization
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="codev-claude-connect-code">
              Authorization code
            </label>
            <Input
              autoComplete="off"
              className="min-h-11 min-w-0 flex-1"
              id="codev-claude-connect-code"
              onChange={(event) => setCode(event.target.value)}
              placeholder="Paste code"
              spellCheck={false}
              value={code}
            />
            <Button
              className="min-h-11"
              disabled={!code.trim() || submitting}
              onClick={() => void submit()}
              size="sm"
              type="button"
              variant="outline"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </Button>
            <Button
              aria-busy={canceling}
              className="min-h-11"
              disabled={canceling}
              onClick={() => {
                if (canceling) {
                  return
                }
                setCanceling(true)
                reset()
                setCanceling(false)
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              {canceling ? 'Canceling…' : 'Cancel'}
            </Button>
          </div>
        </>
      ) : null}
      {phase === 'polling' ? (
        <div
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-2"
          role="status"
        >
          <p className="text-xs text-muted-foreground">
            Linking your Claude subscription… This usually takes a few seconds.
          </p>
          <Button onClick={reset} size="sm" type="button" variant="secondary">
            Cancel
          </Button>
        </div>
      ) : null}
      {phase === 'failed' ? (
        <div className="space-y-2">
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
          <Button className="min-h-11" onClick={reset} size="sm" type="button" variant="outline">
            Try again
          </Button>
        </div>
      ) : null}
      {error && phase !== 'failed' ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
