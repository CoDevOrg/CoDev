import { useEffect, useState, type JSX } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge,
  type CodevBridgeSnapshot
} from '@/web/codev-bridge'

type CodevMemberRole = 'viewer' | 'reviewer' | 'co_steer'

type CodevMember = {
  userId?: string
  login: string
  name: string | null
  role?: string
  accessRole: string
}

const roleLabels: Record<string, string> = {
  owner: 'Maintainer',
  co_steer: 'Maintainer',
  reviewer: 'Collaborator',
  viewer: 'Viewer'
}

function memberName(member: CodevMember): string {
  return member.name ?? member.login
}

function roleLabel(role: string): string {
  return roleLabels[role] ?? role
}

export function CodevWorkspaceMemberRolesView({
  connected,
  members,
  busy,
  message,
  onRoleChange
}: {
  connected: boolean
  members: CodevMember[]
  busy: string
  message: string
  onRoleChange: (memberUserId: string, accessRole: CodevMemberRole) => void
}): JSX.Element {
  const editableMembers = members.filter(
    (member) => member.role !== 'owner' && member.accessRole !== 'owner' && member.userId
  )

  return (
    <div id="codev-workspace-member-roles" className="scroll-mt-6 space-y-3" data-codev-member-roles="true">
      <SettingsSubsectionHeader
        title="Member roles"
        description="Maintainers can change a member’s access. Viewer restrictions apply to editor, terminal, prompt, and review controls."
      />
      {!connected ? (
        <p className="text-xs text-muted-foreground">Connect the CoDev bridge to manage member roles.</p>
      ) : null}
      {editableMembers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No additional members have joined.</p>
      ) : (
        <ul className="space-y-2" aria-label="Member role controls">
          {editableMembers.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
              <span className="min-w-40 text-sm">{memberName(member)} @{member.login}</span>
              <label className="text-xs text-muted-foreground" htmlFor={`codev-member-role-${member.userId}`}>
                Role for {memberName(member)}
              </label>
              <select
                id={`codev-member-role-${member.userId}`}
                aria-label={`Role for ${memberName(member)}`}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                value={member.accessRole}
                disabled={!connected || busy === member.userId}
                onChange={(event) => onRoleChange(member.userId!, event.target.value as CodevMemberRole)}
              >
                <option value="viewer">Viewer</option>
                <option value="reviewer">Collaborator</option>
                <option value="co_steer">Maintainer</option>
              </select>
              <span className="text-xs text-muted-foreground">Current: {roleLabel(member.accessRole)}</span>
              {busy === member.userId ? <Button size="sm" disabled>Saving…</Button> : null}
            </li>
          ))}
        </ul>
      )}
      {message ? <p role="status" className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  )
}

type MemberStatePayload = { members?: CodevMember[] }

export function CodevWorkspaceMemberRolesSection(): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
  const [snapshot, setSnapshot] = useState<CodevBridgeSnapshot>(() => getCodevBridgeSnapshot())
  const [members, setMembers] = useState<CodevMember[]>([])
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => subscribeCodevBridge(() => setSnapshot(getCodevBridgeSnapshot())), [])

  useEffect(() => {
    if (!embedded || snapshot.status !== 'connected') return
    let cancelled = false
    void requestCodevBridge<MemberStatePayload>('invites.list')
      .then((result) => {
        if (!cancelled) setMembers(result.members ?? [])
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'CoDev could not load members.')
      })
    return () => {
      cancelled = true
    }
  }, [embedded, snapshot.status])

  if (!embedded) return null

  function updateRole(memberUserId: string, accessRole: CodevMemberRole): void {
    setBusy(memberUserId)
    setMessage('')
    void requestCodevBridge<MemberStatePayload>('members.update', { memberUserId, accessRole })
      .then((result) => {
        setMembers(result.members ?? [])
        const member = result.members?.find((candidate) => candidate.userId === memberUserId)
        const name = member ? memberName(member) : 'The member'
        setMessage(`${name} is now a ${roleLabel(accessRole)}. Editor, terminal, prompt, and review controls refresh immediately.`)
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : 'CoDev could not update this member.')
      })
      .finally(() => setBusy(''))
  }

  return (
    <CodevWorkspaceMemberRolesView
      connected={snapshot.status === 'connected'}
      members={members}
      busy={busy}
      message={message}
      onRoleChange={updateRole}
    />
  )
}
