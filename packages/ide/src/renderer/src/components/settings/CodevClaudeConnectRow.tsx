import { useEffect, useRef, useState, type JSX } from 'react'

import { Button } from '@/components/ui/button'
import { requestCodevBridge } from '@/web/codev-bridge-singleton'

type ClaudeConnectSessionView = {
  id: string
  status: 'starting' | 'awaiting_code' | 'exchanging' | 'connected' | 'failed'
  authorizeUrl: string | null
  failureReason: string | null
}

type ClaudeConnectPhase = 'idle' | 'starting' | 'awaiting_code' | 'polling' | 'failed'

/** In-app "Connect Claude" flow, driven through the bridge's claudeConnect.* methods. */
export function CodevClaudeConnectRow({
  disabled,
  onConnected
}: {
  disabled: boolean
  onConnected: () => void
}): JSX.Element {
  const [phase, setPhase] = useState<ClaudeConnectPhase>('idle')
  const [session, setSession] = useState<ClaudeConnectSessionView | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const polls = useRef(0)

  useEffect(
    () => () => {
      if (timer.current) {
        clearInterval(timer.current)
      }
    },
    []
  )

  function stop(): void {
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
  }

  function reset(): void {
    stop()
    setPhase('idle')
    setSession(null)
    setCode('')
    setError('')
  }

  async function start(): Promise<void> {
    setPhase('starting')
    setError('')
    try {
      const view = await requestCodevBridge<ClaudeConnectSessionView>('claudeConnect.start')
      setSession(view)
      setPhase('awaiting_code')
    } catch (err) {
      setPhase('failed')
      setError(err instanceof Error ? err.message : 'Claude connect could not start.')
    }
  }

  async function submit(): Promise<void> {
    if (!session || !code.trim()) {
      return
    }
    setError('')
    try {
      await requestCodevBridge('claudeConnect.submitCode', {
        sessionId: session.id,
        code: code.trim()
      })
      setPhase('polling')
      polls.current = 0
      void poll()
      timer.current = setInterval(() => void poll(), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not accepted.')
    }
  }

  async function poll(): Promise<void> {
    if (!session) {
      return
    }
    polls.current += 1
    try {
      const view = await requestCodevBridge<ClaudeConnectSessionView>('claudeConnect.status', {
        sessionId: session.id
      })
      if (view.status === 'connected') {
        stop()
        reset()
        onConnected()
      } else if (view.status === 'failed') {
        stop()
        setPhase('failed')
        setError(view.failureReason ?? 'The connection attempt failed.')
      } else if (polls.current >= 90) {
        stop()
        setPhase('failed')
        setError('Timed out waiting for Claude. Start again.')
      }
    } catch (err) {
      stop()
      setPhase('failed')
      setError(err instanceof Error ? err.message : 'Lost the connection attempt.')
    }
  }

  if (phase === 'idle') {
    return (
      <Button type="button" size="sm" disabled={disabled} onClick={() => void start()}>
        Connect Claude
      </Button>
    )
  }

  return (
    <div
      className="space-y-2 rounded-md border border-border p-3"
      data-codev-claude-connect={phase}
    >
      {phase === 'starting' ? <p className="text-xs text-muted-foreground">Starting…</p> : null}
      {phase === 'awaiting_code' ? (
        <>
          <p className="text-xs text-muted-foreground">
            {session?.authorizeUrl ? (
              <>
                <a
                  className="underline"
                  href={session.authorizeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Claude authorization
                </a>
                , approve access, then paste the code it gives you.
              </>
            ) : (
              'Approve access in Claude, then paste the code it gives you.'
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="codev-claude-connect-code">
              Authorization code
            </label>
            <input
              id="codev-claude-connect-code"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste code"
              className="h-8 min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 text-xs"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <Button type="button" size="sm" disabled={!code.trim()} onClick={() => void submit()}>
              Submit
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={reset}>
              Cancel
            </Button>
          </div>
        </>
      ) : null}
      {phase === 'polling' ? (
        <p className="text-xs text-muted-foreground">Linking your Claude subscription…</p>
      ) : null}
      {phase === 'failed' ? (
        <div className="space-y-2">
          <p className="text-xs text-destructive">{error}</p>
          <Button type="button" size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  )
}
