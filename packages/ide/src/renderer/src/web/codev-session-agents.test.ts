import { describe, expect, it } from 'vitest'
import type { TuiAgent } from '../../../shared/types'
import { codevSessionAgents } from './codev-session-agents'

describe('codevSessionAgents', () => {
  it('keeps only Claude, Codex, and Cursor, in catalog order', () => {
    const catalog = (
      [
        'claude',
        'claude-agent-teams',
        'openclaude',
        'codex',
        'grok',
        'gemini',
        'cursor'
      ] as TuiAgent[]
    ).map((id) => ({ id }))
    expect(codevSessionAgents(catalog).map((entry) => entry.id)).toEqual([
      'claude',
      'codex',
      'cursor'
    ])
  })
})
