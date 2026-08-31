// Backoff schedules for the native-chat seed read (`loadSession` in
// use-native-chat-live-session.ts). Two distinct transient failures:
//
//  - notFound: a brand-new session's transcript can take minutes to appear on
//    disk (#8401). Retry fast for a minute, then fall back to a slow poll while
//    still treating the pane as an empty (not failed) conversation.
//  - transport error: the seed read threw — an RPC timeout or socket blip
//    against a slow or cold paired CoDev host. Usually transient; hold 'loading'
//    and retry within a bounded window instead of dead-ending on
//    "Could not load conversation".

const NOTFOUND_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000]

export const NOTFOUND_RETRY_FIXED_DELAY_MS = 10_000
export const NOTFOUND_RETRY_WINDOW_MS = 60_000
// After the fast window, keep polling slowly this much longer so a late first
// flush (cold CoDev VM, first-run `claude`) still upgrades the pane.
export const NOTFOUND_SLOW_POLL_WINDOW_MS = 10 * 60_000

export function notFoundRetryDelayMs(attempt: number): number {
  return NOTFOUND_RETRY_DELAYS_MS[attempt] ?? NOTFOUND_RETRY_FIXED_DELAY_MS
}

const TRANSPORT_ERROR_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000]
const TRANSPORT_ERROR_RETRY_FIXED_DELAY_MS = 8_000

export const TRANSPORT_ERROR_RETRY_WINDOW_MS = 45_000

export function transportErrorRetryDelayMs(attempt: number): number {
  return TRANSPORT_ERROR_RETRY_DELAYS_MS[attempt] ?? TRANSPORT_ERROR_RETRY_FIXED_DELAY_MS
}
