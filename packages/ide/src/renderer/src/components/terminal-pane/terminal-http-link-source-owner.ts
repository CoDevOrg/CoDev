import type { HttpLinkSourceOwner } from '@/lib/http-link-routing'
import {
  getRemoteRuntimePtyEnvironmentId,
  parseRemoteRuntimePtyId
} from '@/runtime/runtime-terminal-stream'
import type { PtyTransport } from './pty-transport-types'

type OwnerTransport = Pick<PtyTransport, 'getPtyId' | 'getRuntimeEnvironmentId'>

export function resolveTerminalHttpLinkSourceOwner(
  transport: OwnerTransport | null | undefined
): HttpLinkSourceOwner {
  const retainedRuntimeEnvironmentId = transport?.getRuntimeEnvironmentId?.()?.trim()
  if (retainedRuntimeEnvironmentId) {
    return { kind: 'runtime', runtimeEnvironmentId: retainedRuntimeEnvironmentId }
  }

  const ptyId = transport?.getPtyId() ?? null
  if (!ptyId) {
    return { kind: 'local' }
  }

  const runtimeEnvironmentId = getRemoteRuntimePtyEnvironmentId(ptyId)
  if (runtimeEnvironmentId) {
    return { kind: 'runtime', runtimeEnvironmentId }
  }

  // Why: legacy remote ids without a retained transport owner are not evidence of local ownership.
  if (parseRemoteRuntimePtyId(ptyId)) {
    return { kind: 'unknown' }
  }
  return { kind: 'local' }
}
