import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevWorkspaceInvitesView } from './CodevWorkspaceInvitesSection'

describe('CodevWorkspaceInvitesView', () => {
  it('shows a pending invite and current members after create', () => {
    const html = renderToStaticMarkup(
      <CodevWorkspaceInvitesView
        connected
        members={[{ login: 'alex', name: 'Alex Morgan', role: 'owner', accessRole: 'owner' }]}
        invites={[
          {
            inviteId: 'c1f9fe13-6881-44a6-adbd-96bc5a946afa',
            accessRole: 'reviewer',
            status: 'pending',
            expiresAt: '2026-08-14T05:00:00.000Z',
            inviteUrl: 'https://codev.example/invites/token'
          }
        ]}
        accessRole="reviewer"
        busy=""
        message="Invite ready. It expires in 24 hours and can be used once."
        onAccessRoleChange={() => undefined}
        onCreate={() => undefined}
        onRevoke={() => undefined}
      />
    )
    expect(html).toContain('Invite status: Pending')
    expect(html).toContain('Alex Morgan @alex · Maintainer · Member')
    expect(html).toContain('No additional members have joined.')
    expect(html).toContain('Revoke invite')
  })

  it('shows revoked status and that the invitee is not a member', () => {
    const html = renderToStaticMarkup(
      <CodevWorkspaceInvitesView
        connected
        members={[{ login: 'alex', name: 'Alex Morgan', role: 'owner', accessRole: 'owner' }]}
        invites={[
          {
            inviteId: 'c1f9fe13-6881-44a6-adbd-96bc5a946afa',
            accessRole: 'reviewer',
            status: 'revoked'
          }
        ]}
        accessRole="reviewer"
        busy=""
        message="Invite revoked. The invitee is not a workspace member."
        onAccessRoleChange={() => undefined}
        onCreate={() => undefined}
        onRevoke={() => undefined}
      />
    )
    expect(html).toContain('Invite status: Revoked. The invitee is not a workspace member.')
    expect(html).toContain('No additional members have joined.')
    expect(html).not.toContain('Revoke invite')
  })
})
