import { getCodevProviderReadiness, isAgentSendBlocked } from '@/web/codev-provider-readiness'
import { isCodevEmbedded } from '@/web/codev-embedded'
import { getCodevRuntimeReachability } from '@/web/codev-runtime-reachability'

function toastError(title: string, description: string | undefined): void {
  // Imported lazily: this module is on the terminal-pane hot path, and pulling
  // the toast library in at module scope shifted listener-count baselines.
  void import('sonner').then(({ toast }) => {
    toast.error(title, { description })
  })
}

/** CoDev: the parent page says no provider can run an agent on this host. */
function blockedByProvider(): boolean {
  const readiness = getCodevProviderReadiness()
  if (!isAgentSendBlocked(readiness)) {
    return false
  }
  toastError('No agent is set up for this workspace', readiness?.reason ?? undefined)
  return true
}

/** CoDev: the runtime socket is down, so the PTY write would be dropped without a word. */
function blockedByRuntime(): boolean {
  if (!isCodevEmbedded() || getCodevRuntimeReachability() !== 'unreachable') {
    return false
  }
  toastError(
    "Can't reach your workspace",
    "Your message wasn't sent. CoDev is retrying the connection — send it again in a moment."
  )
  return true
}

/**
 * True, after telling the member why, when a send could never reach an agent.
 * Guarding at the send layer rather than the composer covers every route into the PTY.
 */
export function nativeChatSendBlocked(): boolean {
  return blockedByProvider() || blockedByRuntime()
}
