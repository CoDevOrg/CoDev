import { useSyncExternalStore } from 'react'

/**
 * What the parent CoDev page knows about the workspace's machine.
 *
 * The embedded client boots before its EC2 host exists, so "no worktree yet"
 * has two very different causes: the host is still waking (normal, and can take
 * a minute from cold), or the handoff is genuinely stuck. Only the parent can
 * tell them apart — it owns the connect poll — so it says so here instead of
 * leaving the IDE to guess from a stopwatch.
 */
export type CodevHostState = {
  /** 'starting' while the parent is still polling for a runtime. */
  phase: 'starting' | 'ready'
  /** The parent's own slow-start threshold has passed. */
  slow: boolean
}

const CODEV_HOST_STATE_MESSAGE = 'codev:host-state'

let hostState: CodevHostState | null = null
const listeners = new Set<() => void>()
let installed = false

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function parseHostState(data: unknown): CodevHostState | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const message = data as Record<string, unknown>
  if (message.type !== CODEV_HOST_STATE_MESSAGE) {
    return null
  }
  if (message.phase !== 'starting' && message.phase !== 'ready') {
    return null
  }
  return { phase: message.phase, slow: message.slow === true }
}

/**
 * Starts listening for the parent's host-state messages. Called from the web
 * entry point rather than on first subscribe: the awaiting-workspace cover is a
 * lazy chunk, and a report that arrives before it loads must not be lost.
 */
export function installCodevHostStateListener(): void {
  if (installed || typeof window === 'undefined') {
    return
  }
  installed = true
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== window.location.origin) {
      return
    }
    const next = parseHostState(event.data)
    if (!next) {
      return
    }
    if (hostState?.phase === next.phase && hostState.slow === next.slow) {
      return
    }
    hostState = next
    emit()
  })
}

export function subscribeCodevHostState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Null until the parent has reported — an older shell never reports at all. */
export function getCodevHostState(): CodevHostState | null {
  return hostState
}

export function useCodevHostState(): CodevHostState | null {
  return useSyncExternalStore(subscribeCodevHostState, getCodevHostState, getCodevHostState)
}

export function resetCodevHostStateForTest(): void {
  hostState = null
  listeners.clear()
  installed = false
}

/** Test seam: applies a report without a window message. */
export function setCodevHostStateForTest(next: CodevHostState | null): void {
  hostState = next
  emit()
}

/**
 * Tells the CoDev shell that startup hydration threw, and where. The embedded
 * client has no telemetry channel of its own — `startupDiagnostic` goes to the
 * desktop main process, which does not exist here — so the failing step would
 * otherwise live only in an iframe's console.
 */
export function reportCodevStartupFailure(step: string | null, message: string): void {
  if (typeof window === 'undefined' || window.parent === window) {
    return
  }
  try {
    window.parent.postMessage(
      { type: 'codev:startup-failure', step, message },
      window.location.origin
    )
  } catch {
    // Reporting a failure must never cause one.
  }
}
