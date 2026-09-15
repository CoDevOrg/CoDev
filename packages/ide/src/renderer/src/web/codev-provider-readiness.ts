import { useSyncExternalStore } from 'react'

/**
 * Whether a provider can actually run an agent here. Only the parent knows:
 * a workspace runs on a shared host, so a browser subscription that works in
 * a chat room never reaches it. Without this the IDE took messages for an
 * agent that could never reply.
 */
export type CodevProviderReadiness = {
  /** At least one agent can run in this workspace on this member's login. */
  ready: boolean
  /** The agent that will run, when one can. */
  agent: 'claude' | 'codex' | null
  /** One line naming why nothing can run, and what fixes it. Null when ready. */
  reason: string | null
  /** Where the fix lives, for a link out of the iframe. */
  settingsHref: string | null
}

const CODEV_PROVIDER_READINESS_MESSAGE = 'codev:provider-readiness'
export const CODEV_PROVIDER_READINESS_REFRESH_MESSAGE = 'codev:provider-readiness-refresh'

let readiness: CodevProviderReadiness | null = null
const listeners = new Set<() => void>()
let installed = false

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function optionalText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.slice(0, max) : null
}

function parseReadiness(data: unknown): CodevProviderReadiness | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const message = data as Record<string, unknown>
  if (message.type !== CODEV_PROVIDER_READINESS_MESSAGE) {
    return null
  }
  if (typeof message.ready !== 'boolean') {
    return null
  }
  return {
    ready: message.ready,
    agent: message.agent === 'claude' || message.agent === 'codex' ? message.agent : null,
    reason: optionalText(message.reason, 300),
    settingsHref: optionalText(message.settingsHref, 300)
  }
}

function sameReadiness(
  left: CodevProviderReadiness | null,
  right: CodevProviderReadiness
): boolean {
  return (
    left?.ready === right.ready &&
    left.agent === right.agent &&
    left.reason === right.reason &&
    left.settingsHref === right.settingsHref
  )
}

/** Installed from the web entry point, not on first subscribe: the surfaces
 *  that read it are lazy chunks and must not miss an early report. */
export function installCodevProviderReadinessListener(): void {
  if (installed || typeof window === 'undefined') {
    return
  }
  installed = true
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== window.location.origin) {
      return
    }
    const next = parseReadiness(event.data)
    if (!next || sameReadiness(readiness, next)) {
      return
    }
    readiness = next
    emit()
  })
}

export function subscribeCodevProviderReadiness(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Null until the parent reports — also the desktop app, where none exists.
 *  Null means "nothing blocked", never "not ready". */
export function getCodevProviderReadiness(): CodevProviderReadiness | null {
  return readiness
}

export function useCodevProviderReadiness(): CodevProviderReadiness | null {
  return useSyncExternalStore(
    subscribeCodevProviderReadiness,
    getCodevProviderReadiness,
    getCodevProviderReadiness
  )
}

/** The composer's gate: blocked, and why. Null off the CoDev surface. */
export function useCodevAgentSendGate(): { blocked: boolean; reason: string | null } {
  const state = useCodevProviderReadiness()
  const blocked = isAgentSendBlocked(state)
  return { blocked, reason: blocked ? (state?.reason ?? null) : null }
}

/** Phrased as "blocked" so the null case reads right at the call site. */
export function isAgentSendBlocked(state: CodevProviderReadiness | null): boolean {
  return state !== null && !state.ready
}

export function resetCodevProviderReadinessForTest(): void {
  readiness = null
  listeners.clear()
  installed = false
}

/** Applies a readiness report locally — used after a connect in this iframe
 *  so the composer unblocks without waiting for the parent to round-trip. */
export function applyCodevProviderReadiness(next: CodevProviderReadiness | null): void {
  if (next === null) {
    if (readiness === null) {
      return
    }
    readiness = null
    emit()
    return
  }
  if (sameReadiness(readiness, next)) {
    return
  }
  readiness = next
  emit()
}

/** Ask the parent to re-read connections and post an updated report. */
export function requestCodevProviderReadinessRefresh(): void {
  if (typeof window === 'undefined' || window.parent === window) {
    return
  }
  window.parent.postMessage(
    { type: CODEV_PROVIDER_READINESS_REFRESH_MESSAGE },
    window.location.origin
  )
}

/** Test seam: applies a report without a window message. */
export function setCodevProviderReadinessForTest(next: CodevProviderReadiness | null): void {
  applyCodevProviderReadiness(next)
}
