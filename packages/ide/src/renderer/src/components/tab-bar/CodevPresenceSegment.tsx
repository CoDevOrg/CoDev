import { useEffect, useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge
} from '@/web/codev-bridge-singleton'

export type CodevPresenceMember = {
  user: { id: string; login: string; name: string | null }
  path: string | null
}

type PresencePayload = { members?: CodevPresenceMember[] }

function memberLabel(member: CodevPresenceMember): string {
  return member.user.name?.trim() || member.user.login
}

export function CodevPresenceView({
  activePath,
  members
}: {
  activePath: string | null
  members: CodevPresenceMember[]
}): React.JSX.Element | null {
  const namedMembers = members.slice(0, 3)
  if (!activePath || namedMembers.length === 0) {
    return null
  }
  const remote = namedMembers.filter((member) => member.path && member.path !== activePath)
  const title = remote.length
    ? `${remote.map(memberLabel).join(', ')} viewing ${remote[0]?.path}`
    : `${namedMembers.map(memberLabel).join(', ')} viewing ${activePath}`
  return (
    <div
      aria-label="CoDev editor presence"
      className="mx-1 flex min-w-0 items-center gap-1.5 self-center rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground"
      title={title}
    >
      <Users aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate font-medium text-foreground">
        {namedMembers.map(memberLabel).join(', ')}
      </span>
      {remote.length ? <span className="truncate">viewing {remote[0]?.path}</span> : null}
    </div>
  )
}

export function CodevPresenceSegment({
  activePath
}: {
  activePath: string | null
}): React.JSX.Element | null {
  const [connected, setConnected] = useState(() => getCodevBridgeSnapshot().status === 'connected')
  const [members, setMembers] = useState<CodevPresenceMember[]>([])

  useEffect(
    () => subscribeCodevBridge(() => setConnected(getCodevBridgeSnapshot().status === 'connected')),
    []
  )

  useEffect(() => {
    if (!connected || !activePath) return
    let disposed = false
    const refresh = (): void => {
      void requestCodevBridge<PresencePayload>('presence.list')
        .then((payload) => {
          if (!disposed) setMembers(Array.isArray(payload.members) ? payload.members : [])
        })
        .catch(() => {
          if (!disposed) setMembers([])
        })
    }
    void requestCodevBridge('presence.update', { path: activePath })
      .then(refresh)
      .catch(() => undefined)
    refresh()
    const timer = window.setInterval(refresh, 5_000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [activePath, connected])

  const visibleMembers = useMemo(() => members.filter((member) => member.path), [members])
  return <CodevPresenceView activePath={activePath} members={visibleMembers} />
}
