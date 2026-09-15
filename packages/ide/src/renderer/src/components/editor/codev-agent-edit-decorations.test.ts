import { describe, expect, it } from 'vitest'
import type { editor } from 'monaco-editor'

import type { CodevAgentFilePresence } from '@/web/codev-live-edit-presence'
import {
  buildCodevAgentEditDecorations,
  buildCodevAgentEditKindCss,
  codevAgentEditKindClass,
  codevAgentEditLabel,
} from './codev-agent-edit-decorations'

function presence(over: Partial<CodevAgentFilePresence>): CodevAgentFilePresence {
  return {
    paneKey: 'tab-1:a',
    worktreeId: 'wt',
    agentKind: 'codex',
    filePath: 'src/a.ts',
    startLine: null,
    endLine: null,
    tool: 'Edit',
    at: 1,
    expiresInMs: 5_000,
    ...over,
  }
}

describe('codevAgentEditLabel', () => {
  it('names known kinds and title-cases the tail', () => {
    expect(codevAgentEditLabel('claude-code')).toBe('Claude')
    expect(codevAgentEditLabel('codex')).toBe('Codex')
    expect(codevAgentEditLabel('some_new-agent')).toBe('Some New Agent')
  })
})

describe('codevAgentEditKindClass', () => {
  it('produces a css-safe, stable class', () => {
    expect(codevAgentEditKindClass('claude-code')).toBe('codev-agent-edit--claude-code')
    expect(codevAgentEditKindClass('Weird/Kind!!')).toBe('codev-agent-edit--weird-kind')
    expect(codevAgentEditKindClass('')).toBe('codev-agent-edit--other')
  })
})

describe('buildCodevAgentEditKindCss', () => {
  it('emits one rule set per distinct kind, referencing its colour', () => {
    const css = buildCodevAgentEditKindCss(['codex', 'codex', 'cursor'])
    expect(css).toContain('.codev-agent-edit--codex.codev-agent-edit-glyph')
    expect(css).toContain('.codev-agent-edit--cursor.codev-agent-edit-line')
    expect(css.match(/codev-agent-edit--codex\.codev-agent-edit-glyph/g)).toHaveLength(1)
  })
})

describe('buildCodevAgentEditDecorations', () => {

  it('is empty when the editor has no model', () => {
    const noModel = { getModel: () => null } as unknown as editor.IStandaloneCodeEditor
    expect(buildCodevAgentEditDecorations(noModel, [presence({})])).toEqual([])
  })
})
