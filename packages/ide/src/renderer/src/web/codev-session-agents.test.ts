import { describe, expect, it } from 'vitest'
import type { TuiAgent } from '../../../shared/types'
import { codevSessionAgents } from './codev-session-agents'

describe('codevSessionAgents', () => {
  it('keeps only Claude and Codex, in catalog order', () => {
    const catalog = (['claude', 'claude-agent-teams', 'codex'] as TuiAgent[]).map((id) => ({ id }))
    expect(codevSessionAgents(catalog).map((entry) => entry.id)).toEqual(['claude', 'codex'])
  })
})
