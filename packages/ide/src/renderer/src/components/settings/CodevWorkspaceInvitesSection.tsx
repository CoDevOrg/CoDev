import { useEffect, useState, type JSX } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge,
  type CodevBridgeSnapshot
} from '../../web/codev-bridge-singleton'

export type CodevInviteAccessRole = 'viewer' | 'reviewer' | 'co_steer'

export type CodevInviteRecord = {
  inviteId: string
  accessRole: CodevInviteAccessRole | 'owner'
  invitee?: string | null
  allowLink?: boolean
  expiresAt?: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  inviteUrl?: string
}

export type CodevInviteMember = {
  userId?: string
  login: string
  name: string | null
  role?: string
  accessRole: string
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Maintainer',
  co_steer: 'Maintainer',
  reviewer: 'Collaborator',
  viewer: 'Viewer'
}

function roleLabel(accessRole: string): string {
  return ROLE_LABELS[accessRole] ?? accessRole
}

function statusLabel(status: CodevInviteRecord['status']): string {
  if (status === 'pending') return 'Pending'
  if (status === 'accepted') return 'Accepted'
  if (status === 'revoked') return 'Revoked'
  return 'Expired'
}

export function CodevWorkspaceInvitesView({
  connected,
  members,
  invites,
  accessRole,
  busy,
  message,
  onAccessRoleChange,
  onCreate,
  onRevoke
}: {
  connected: boolean
  members: CodevInviteMember[]
  invites: CodevInviteRecord[]
  accessRole: CodevInviteAccessRole
  busy: string
  message: string
  onAccessRoleChange: (role: CodevInviteAccessRole) => void
  onCreate: () => void
  onRevoke: (inviteId: string) => void
}): JSX.Element {
  const additionalMembers = members.filter(
    (member) => member.role !== 'owner' && member.accessRole !== 'owner'
  )
  const latestInvite = invites[0] ?? null

  return (
    <div id="codev-workspace-invites" className="scroll-mt-6 space-y-3" data-codev-invites="true">
      <SettingsSubsectionHeader
        title="Invites"
        description="Create a revocable, expiring invite. Acceptance, revocation, and expiry update membership here."
      />
      {!connected ? (
        <p className="text-xs text-muted-foreground">
          Connect the CoDev bridge to manage workspace invites.
        </p>
      ) : null}
      <section aria-label="Workspace members" className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">Members</h4>
        <ul className="space-y-1">
          {members.map((member) => (
            <li key={member.login} className="text-sm">
              {member.name ?? member.login} @{member.login} · {roleLabel(member.accessRole)} ·
              Member
            </li>
          ))}
        </ul>
        {additionalMembers.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No additional members have joined.
          </p>
        ) : null}
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground" htmlFor="codev-invite-role">
          Invite role
        </label>
        <select
          id="codev-invite-role"
          aria-label="Invite role"
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          value={accessRole}
          disabled={!connected || busy === 'create'}
          onChange={(event) => onAccessRoleChange(event.target.value as CodevInviteAccessRole)}
        >
          <option value="viewer">Viewer</option>
          <option value="reviewer">Collaborator</option>
          <option value="co_steer">Maintainer</option>
        </select>
        <Button
          type="button"
          size="sm"
          disabled={!connected || busy === 'create'}
          onClick={onCreate}
        >
          {busy === 'create' ? 'Creating…' : 'Create invite'}
        </Button>
      </div>
      {invites.map((invite) => (
        <article
          key={invite.inviteId}
          className="space-y-1 rounded-md border border-border p-3"
          aria-label={`Invite ${statusLabel(invite.status).toLowerCase()}`}
        >
          <p role="status" className="text-sm">
            Invite status: {statusLabel(invite.status)}
            {invite.status === 'revoked' || invite.status === 'expired'
              ? '. The invitee is not a workspace member.'
              : invite.status === 'accepted'
                ? '. The invitee is a workspace member.'
                : ` · ${roleLabel(invite.accessRole)} · expires ${
                    invite.expiresAt
                      ? new Date(invite.expiresAt).toLocaleString()
                      : 'in 24 hours'
                  }`}
          </p>
          {invite.inviteUrl ? (
            <p className="break-all font-mono text-[11px] text-muted-foreground">{invite.inviteUrl}</p>
          ) : null}
          {invite.status === 'pending' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy === invite.inviteId}
              onClick={() => onRevoke(invite.inviteId)}
            >
              {busy === invite.inviteId ? 'Revoking…' : 'Revoke invite'}
            </Button>
          ) : null}
        </article>
      ))}
      {latestInvite ? null : connected ? (
        <p className="text-xs text-muted-foreground">No invites yet.</p>
      ) : null}
      {message ? (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}

type InviteStatePayload = {
  members?: CodevInviteMember[]
  invites?: CodevInviteRecord[]
  inviteId?: string
  inviteUrl?: string
  status?: CodevInviteRecord['status']
  expiresAt?: string
  accessRole?: CodevInviteAccessRole
}

function mergeInviteUrls(
  invites: CodevInviteRecord[],
  urls: Record<string, string>,
  created?: { inviteId?: string; inviteUrl?: string }
): { invites: CodevInviteRecord[]; urls: Record<string, string> } {
  const nextUrls = { ...urls }
  if (created?.inviteId && created.inviteUrl) {
    nextUrls[created.inviteId] = created.inviteUrl
  }
  return {
    urls: nextUrls,
    invites: invites.map((invite) =>
      nextUrls[invite.inviteId] ? { ...invite, inviteUrl: nextUrls[invite.inviteId] } : invite
    )
  }
}

export function CodevWorkspaceInvitesSection(): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
  const [snapshot, setSnapshot] = useState<CodevBridgeSnapshot>(() => getCodevBridgeSnapshot())
  const [members, setMembers] = useState<CodevInviteMember[]>([])
  const [invites, setInvites] = useState<CodevInviteRecord[]>([])
  const [inviteUrls, setInviteUrls] = useState<Record<string, string>>({})
  const [accessRole, setAccessRole] = useState<CodevInviteAccessRole>('reviewer')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    return subscribeCodevBridge(() => {
      setSnapshot(getCodevBridgeSnapshot())
    })
  }, [])

  useEffect(() => {
    if (!embedded || snapshot.status !== 'connected') {
      return
    }
    let cancelled = false
    void requestCodevBridge<InviteStatePayload>('invites.list')
      .then((result) => {
        if (cancelled) {
          return
        }
        const merged = mergeInviteUrls(result.invites ?? [], inviteUrls)
        setMembers(result.members ?? [])
        setInvites(merged.invites)
        setInviteUrls(merged.urls)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : 'CoDev could not load invites.')
        }
      })
    return () => {
      cancelled = true
    }
    // Load once per connection; inviteUrls is session-local and should not retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, snapshot.status])

  if (!embedded) {
    return null
  }

  async function createInvite(): Promise<void> {
    setBusy('create')
    setMessage('')
    try {
      const result = await requestCodevBridge<InviteStatePayload>('invites.create', { accessRole })
      const merged = mergeInviteUrls(result.invites ?? [], inviteUrls, result)
      setMembers(result.members ?? [])
      setInvites(merged.invites)
      setInviteUrls(merged.urls)
      setMessage('Invite ready. It expires in 24 hours and can be used once.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'CoDev could not create this invite.')
    } finally {
      setBusy('')
    }
  }

  async function revokeInvite(inviteId: string): Promise<void> {
    setBusy(inviteId)
    setMessage('')
    try {
      const result = await requestCodevBridge<InviteStatePayload>('invites.revoke', { inviteId })
      const merged = mergeInviteUrls(result.invites ?? [], inviteUrls)
      setMembers(result.members ?? [])
      setInvites(merged.invites)
      setInviteUrls(merged.urls)
      setMessage('Invite revoked. The invitee is not a workspace member.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'CoDev could not revoke this invite.')
    } finally {
      setBusy('')
    }
  }

  return (
    <CodevWorkspaceInvitesView
      connected={snapshot.status === 'connected'}
      members={members}
      invites={invites}
      accessRole={accessRole}
      busy={busy}
      message={message}
      onAccessRoleChange={setAccessRole}
      onCreate={() => void createInvite()}
      onRevoke={(inviteId) => void revokeInvite(inviteId)}
    />
  )
}
