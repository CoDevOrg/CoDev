import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevPresenceView } from './CodevPresenceSegment'

describe('CodevPresenceView', () => {
  it('renders named collaborators and their remote active file in editor chrome', () => {
    const html = renderToStaticMarkup(
      <CodevPresenceView
        activePath="src/hello.ts"
        members={[
          {
            user: { id: 'alex', login: 'alex', name: 'Alex Morgan' },
            path: 'src/hello.ts'
          },
          {
            user: { id: 'jordan', login: 'jordan', name: 'Jordan Lee' },
            path: 'README.md'
          }
        ]}
      />
    )
    expect(html).toContain('CoDev editor presence')
    expect(html).toContain('Alex Morgan, Jordan Lee')
    expect(html).toContain('viewing README.md')
  })
})
