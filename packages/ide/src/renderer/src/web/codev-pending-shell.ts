import {
  clearStoredWebRuntimeEnvironment,
  readStoredWebRuntimeEnvironment,
  type StoredWebRuntimeEnvironment
} from './web-runtime-environment'
import { isCodevEmbedded } from './codev-embedded'

let detached: { environment: StoredWebRuntimeEnvironment | null } | null = null

/**
 * The stored pairing is browser-wide, so a waking workspace's shell would
 * otherwise connect to whichever workspace this browser opened last. Clears it
 * once (StrictMode re-renders get the same answer) and hands it back only as
 * continuity for the pairing that arrives over `codev:pair`.
 */
export function detachStoredEnvironmentForPendingShell(): StoredWebRuntimeEnvironment | null {
  if (!detached) {
    detached = { environment: readStoredWebRuntimeEnvironment() }
    clearStoredWebRuntimeEnvironment()
  }
  return detached.environment
}

/**
 * True while the CoDev shell is showing the IDE *before* its workspace has a
 * runtime — the client mounts the instant the workspace route opens, and the
 * pairing arrives later over `codev:pair`.
 *
 * Nothing in the startup hydration chain can succeed in that window: every step
 * routes through the runtime RPC, which throws "Pair this web client with an
 * Orca server first." until an environment exists. Running the chain anyway
 * turned a normal cold open into a permanent "Session restore failed" toast
 * claiming the member's changes would not be saved — on a workspace that then
 * paired and hydrated perfectly a moment later.
 *
 * `web/main.tsx` owns the flag, because only it knows which of the two `<App>`
 * mounts this is — the `codevPending` fragment stays set for the whole session,
 * including after pairing. A returning member can carry a stale environment in
 * storage, so the flag decides and the missing environment is the fallback for
 * a shell that never set it.
 */
export function isCodevPendingShell(): boolean {
  if (typeof window === 'undefined' || !isCodevEmbedded()) {
    return false
  }
  if (window.__CODEV_PENDING_SHELL__ !== undefined) {
    return window.__CODEV_PENDING_SHELL__
  }
  return readStoredWebRuntimeEnvironment() === null
}
