import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevWorkspaceMemberRolesView } from './CodevWorkspaceMemberRolesSection'

describe('CodevWorkspaceMemberRolesView', () => {
  it('lets a maintainer change a collaborator to Viewer and names the native restrictions', () => {
    const html = renderToStaticMarkup(
      <CodevWorkspaceMemberRolesView
        connected
        members={[
          { userId: 'owner', login: 'alex', name: 'Alex Morgan', role: 'owner', accessRole: 'owner' },
          { userId: 'member', login: 'jordan', name: 'Jordan Lee', role: 'member', accessRole: 'reviewer' }
        ]}
        busy=""
        message="Jordan Lee is now a Viewer. Editor, terminal, prompt, and review controls refresh immediately."
        onRoleChange={() => undefined}
      />
    )
    expect(html).toContain('Member roles')
    expect(html).toContain('Role for Jordan Lee')
    expect(html).toContain('Viewer')
    expect(html).toContain('Editor, terminal, prompt, and review controls refresh immediately.')
  })

  it('keeps owner roles informational and does not expose an owner editor', () => {
    const html = renderToStaticMarkup(
      <CodevWorkspaceMemberRolesView
        connected
        members={[{ userId: 'owner', login: 'alex', name: 'Alex Morgan', role: 'owner', accessRole: 'owner' }]}
        busy=""
        message=""
        onRoleChange={() => undefined}
      />
    )
    expect(html).not.toContain('Role for Alex Morgan')
  })
})
