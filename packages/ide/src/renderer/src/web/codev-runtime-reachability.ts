import { useSyncExternalStore } from 'react'

/** Whether the workspace runtime's socket is up, as a member experiences it. */
export type CodevRuntimeReachability = 'connecting' | 'connected' | 'unreachable'

export type CodevRuntimeClientState =
  | 'disconnected'
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'auth-failed'

/** One dropped attempt is ordinary while a host wakes; two in a row is an outage. */
const UNREACHABLE_AFTER_FAILURES = 2

let reachability: CodevRuntimeReachability = 'connecting'
let consecutiveFailures = 0
const listeners = new Set<() => void>()

function update(next: CodevRuntimeReachability): void {
  if (next === reachability) {
    return
  }
  reachability = next
  for (const listener of listeners) {
    listener()
  }
}

/** Fed by the active runtime client's state transitions. */
export function reportCodevRuntimeClientState(state: CodevRuntimeClientState): void {
  if (state === 'connected') {
    consecutiveFailures = 0
    update('connected')
    return
  }
  if (state === 'auth-failed') {
    update('unreachable')
    return
  }
  if (state === 'disconnected') {
    consecutiveFailures += 1
    update(consecutiveFailures >= UNREACHABLE_AFTER_FAILURES ? 'unreachable' : 'connecting')
    return
  }
  // A retry stays unreachable until it lands, so the status does not flicker.
  if (reachability !== 'unreachable') {
    update('connecting')
  }
}

/** A replaced or closed client starts over; its first attempt is not a failure. */
export function resetCodevRuntimeReachability(): void {
  consecutiveFailures = 0
  update('connecting')
}

export function getCodevRuntimeReachability(): CodevRuntimeReachability {
  return reachability
}

export function subscribeCodevRuntimeReachability(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useCodevRuntimeReachability(): CodevRuntimeReachability {
  return useSyncExternalStore(
    subscribeCodevRuntimeReachability,
    getCodevRuntimeReachability,
    getCodevRuntimeReachability
  )
}
