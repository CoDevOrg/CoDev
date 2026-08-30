import { describe, expect, it } from 'vitest'
import { CURSOR_HEARTBEAT_MS, selectRemoteCursors } from './codev-cursor-decorations'

describe('selectRemoteCursors', () => {
  it('keeps publishing an unchanged selection for the presence TTL heartbeat', () => {
    expect(CURSOR_HEARTBEAT_MS).toBeLessThan(60_000)
  })

  it('keeps only another collaborator’s cursor for the active editor path', () => {
    const cursors = selectRemoteCursors(
      [
        {
          user: { id: 'alex', login: 'alex', name: 'Alex Morgan' },
          path: 'README.md',
          cursor: { anchor: 3, head: 12 }
        },
        {
          user: { id: 'jordan', login: 'jordan', name: 'Jordan Lee' },
          path: 'README.md',
          cursor: { anchor: 0, head: 0 }
        },
        {
          user: { id: 'sam', login: 'sam', name: 'Sam Lee' },
          path: 'src/presence.ts',
          cursor: { anchor: 1, head: 4 }
        }
      ],
      'alex',
      'README.md'
    )

    expect(cursors).toEqual([
      {
        user: { id: 'jordan', login: 'jordan', name: 'Jordan Lee' },
        path: 'README.md',
        cursor: { anchor: 0, head: 0 }
      }
    ])
  })
})
