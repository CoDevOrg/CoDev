import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevProfileView } from './CodevProfileSection'

describe('CodevProfileView', () => {
  it('shows identity and connected-account status', () => {
    const html = renderToStaticMarkup(
      <CodevProfileView
        connected
        profile={{
          name: 'Jordan Lee',
          email: 'jordan@example.com',
          google: { connected: true },
          github: { connected: true, login: 'jordanlee' },
          githubConnectUrl: null
        }}
      />
    )
    expect(html).toContain('Jordan Lee')
    expect(html).toContain('jordan@example.com')
    expect(html).toContain('Google')
    expect(html).toContain('@jordanlee')
  })

  it('offers a top-level GitHub connect link when not linked', () => {
    const html = renderToStaticMarkup(
      <CodevProfileView
        connected
        profile={{
          name: 'Jordan Lee',
          email: 'jordan@example.com',
          google: { connected: true },
          github: { connected: false, login: null },
          githubConnectUrl: '/api/personal/profile/connect-github'
        }}
      />
    )
    expect(html).toContain('/api/personal/profile/connect-github')
    expect(html).toContain('target="_top"')
  })

  it('prompts to connect the bridge before loading anything', () => {
    const html = renderToStaticMarkup(<CodevProfileView connected={false} profile={null} />)
    expect(html).toContain('Connect the CoDev bridge')
    expect(html).not.toContain('jordan@example.com')
  })
})
