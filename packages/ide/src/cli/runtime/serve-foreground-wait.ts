import type { ChildProcess } from 'node:child_process'
import { serveSignalExitError } from './serve-signal-exit-diagnostic'

const FORCE_KILL_AFTER_MS = 5000

/**
 * Waits for the foreground `orca serve` child, forwarding SIGINT/SIGTERM so a
 * supervisor stopping the CLI also stops the server. Resolves with the child's
 * exit code; a signal exit is surfaced as a `runtime_serve_failed` error.
 */
export function waitForForegroundServe(child: ChildProcess): Promise<number> {
  return new Promise((resolveWait, reject) => {
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null
    const forwardSignal = (signal: NodeJS.Signals): void => {
      child.kill(signal)
      forceKillTimer ??= setTimeout(() => child.kill('SIGKILL'), FORCE_KILL_AFTER_MS)
    }
    const cleanup = (): void => {
      process.off('SIGINT', forwardSignal)
      process.off('SIGTERM', forwardSignal)
      if (forceKillTimer) {
        clearTimeout(forceKillTimer)
      }
    }
    process.on('SIGINT', forwardSignal)
    process.on('SIGTERM', forwardSignal)
    const handleExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup()
      if (typeof code === 'number') {
        resolveWait(code)
        return
      }
      reject(serveSignalExitError(signal))
    }
    child.once('error', (error) => {
      cleanup()
      child.off?.('exit', handleExit)
      reject(error)
    })
    child.once('exit', handleExit)
  })
}
