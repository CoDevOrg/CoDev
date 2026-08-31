import { describe, expect, it } from 'vitest'

import {
  deriveCodevLiveEdit,
  isCodevFileWriteTool,
  normalizeCodevAgentKind,
  normalizeWorktreeRelativePath,
  type CodevLiveEditSource,
} from './codev-live-edit'

const base: CodevLiveEditSource = {
  paneKey: 'tab-7:5c2f0b1e-0000-4000-8000-000000000000',
  worktreeId: 'agent-checkout-guard',
  agentKind: 'claude',
  toolName: 'Edit',
  toolInput: { file_path: 'src/checkout/reserve.ts', old_string: 'a', new_string: 'b' },
  now: 1_700_000_000_000,
}

describe('isCodevFileWriteTool', () => {
  it('accepts write tools across CLIs and rejects read/shell tools', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'write_file', 'apply_patch', 'replace_file_content']) {
      expect(isCodevFileWriteTool(tool)).toBe(true)
    }
    for (const tool of ['Read', 'Bash', 'Grep', 'WebFetch', 'read_file', undefined]) {
      expect(isCodevFileWriteTool(tool)).toBe(false)
    }
  })
})

describe('normalizeCodevAgentKind', () => {
  it('maps raw hook agent types onto the closed telemetry enum', () => {
    expect(normalizeCodevAgentKind('claude')).toBe('claude-code')
    expect(normalizeCodevAgentKind('Anthropic')).toBe('claude-code')
    expect(normalizeCodevAgentKind('openai')).toBe('codex')
    expect(normalizeCodevAgentKind('codex')).toBe('codex')
    expect(normalizeCodevAgentKind('gemini')).toBe('gemini')
    expect(normalizeCodevAgentKind('cursor')).toBe('cursor')
    expect(normalizeCodevAgentKind('totally-unknown')).toBe('other')
    expect(normalizeCodevAgentKind(undefined)).toBe('other')
  })
})

describe('normalizeWorktreeRelativePath', () => {
  it('strips the worktree root and normalises separators', () => {
    expect(
      normalizeWorktreeRelativePath('/srv/codev/wt/src\\lib\\money.ts', '/srv/codev/wt'),
    ).toBe('src/lib/money.ts')
    expect(normalizeWorktreeRelativePath('./src/app.ts')).toBe('src/app.ts')
  })

  it('rejects paths that escape the checkout', () => {
    expect(normalizeWorktreeRelativePath('/etc/passwd')).toBeNull()
    expect(normalizeWorktreeRelativePath('../../secrets.txt', '/srv/codev/wt')).toBeNull()
    expect(normalizeWorktreeRelativePath('~/notes.md')).toBeNull()
    expect(normalizeWorktreeRelativePath('C:/Windows/system32')).toBeNull()
    expect(normalizeWorktreeRelativePath('   ')).toBeNull()
  })
})

describe('deriveCodevLiveEdit', () => {
  it('derives a placed edit from a Claude Edit call', () => {
    expect(deriveCodevLiveEdit(base)).toEqual({
      paneKey: base.paneKey,
      worktreeId: 'agent-checkout-guard',
      agentKind: 'claude-code',
      filePath: 'src/checkout/reserve.ts',
      startLine: null,
      endLine: null,
      tool: 'Edit',
      at: 1_700_000_000_000,
    })
  })

  it('reads an explicit line range and collapses a lone start to a caret', () => {
    const ranged = deriveCodevLiveEdit({
      ...base,
      toolName: 'replace_file_content',
      toolInput: { TargetFile: 'src/api/handler.ts', start_line: 12, end_line: 20 },
    })
    expect(ranged).toMatchObject({ filePath: 'src/api/handler.ts', startLine: 12, endLine: 20 })

    const caret = deriveCodevLiveEdit({
      ...base,
      toolInput: { file_path: 'src/api/handler.ts', line: 5 },
    })
    expect(caret).toMatchObject({ startLine: 5, endLine: 5 })
  })

  it('derives a range from offset + limit windowing', () => {
    expect(
      deriveCodevLiveEdit({
        ...base,
        toolInput: { file_path: 'a.ts', offset: 30, limit: 10 },
      }),
    ).toMatchObject({ startLine: 30, endLine: 39 })
  })

  it('accepts a JSON-string tool input and a bare path string', () => {
    expect(
      deriveCodevLiveEdit({ ...base, toolInput: '{"file_path":"src/x.ts"}' }),
    ).toMatchObject({ filePath: 'src/x.ts' })
    expect(
      deriveCodevLiveEdit({ ...base, toolName: 'write', toolInput: 'src/y.ts' }),
    ).toMatchObject({ filePath: 'src/y.ts', tool: 'write' })
  })

  it('returns null when the observation cannot be placed', () => {
    expect(deriveCodevLiveEdit({ ...base, toolName: 'Read' })).toBeNull()
    expect(deriveCodevLiveEdit({ ...base, worktreeId: '  ' })).toBeNull()
    expect(deriveCodevLiveEdit({ ...base, paneKey: null })).toBeNull()
    expect(deriveCodevLiveEdit({ ...base, toolInput: { old_string: 'a' } })).toBeNull()
    expect(
      deriveCodevLiveEdit({
        ...base,
        toolInput: { file_path: '../../outside.ts' },
        worktreeRoot: '/srv/codev/wt',
      }),
    ).toBeNull()
  })
})
