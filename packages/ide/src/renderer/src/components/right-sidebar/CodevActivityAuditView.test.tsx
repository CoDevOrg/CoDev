import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevActivityAuditViewPanel, type CodevActivitySnapshot } from './CodevActivityAuditView'

const snapshot: CodevActivitySnapshot = {
  viewer: { id: 'user-1', name: 'CoDev Test Jordan' },
  filters: { kind: 'diff', query: 'review_merged' },
  events: [
    {
      id: 'event-1',
      sequence: 12,
      type: 'agent.review_merged',
      actor: 'CoDev Test Jordan',
      summary: 'CoDev Test Jordan integrated a reviewed checkpoint',
      createdAt: '2026-08-15T19:28:00.000Z',
      path: null,
      sessionId: 'session-3',
      jump: {
        kind: 'diff',
        surface: 'checks',
        label: 'Open Checks · diff',
        path: null,
        sessionId: 'session-3'
      }
    }
  ],
  filtered: [],
}

describe('CodevActivityAuditViewPanel', () => {
  it('renders a filtered audit event and its native jump control', () => {
    const html = renderToStaticMarkup(
      <CodevActivityAuditViewPanel
        connected
        snapshot={snapshot}
        kind="diff"
        query="review_merged"
        busy=""
        jumped=""
        onKindChange={() => undefined}
        onQueryChange={() => undefined}
        onRefresh={() => undefined}
        onJump={() => undefined}
      />
    )
    expect(html).toContain('Workspace activity')
    expect(html).toContain('Activity filter')
    expect(html).toContain('CoDev Test Jordan integrated a reviewed checkpoint')
    expect(html).toContain('agent.review_merged')
    expect(html).toContain('Open Checks · diff')
  })

  it('shows the empty filter state and a completed jump', () => {
    const html = renderToStaticMarkup(
      <CodevActivityAuditViewPanel
        connected
        snapshot={{ ...snapshot, events: [] }}
        kind="file"
        query="missing"
        busy=""
        jumped="Jumped to Checks · agent.review_merged"
        onKindChange={() => undefined}
        onQueryChange={() => undefined}
        onRefresh={() => undefined}
        onJump={() => undefined}
      />
    )
    expect(html).toContain('No matching activity events.')
    expect(html).toContain('Jumped to Checks · agent.review_merged')
  })
})
