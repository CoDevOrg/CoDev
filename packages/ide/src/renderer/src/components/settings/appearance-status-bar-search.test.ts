import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/i18n/localized-catalog', () => ({
  createLocalizedCatalog:
    <T>(loader: () => T) =>
    () =>
      loader()
}))

vi.mock('./settings-search-keywords', () => ({
  translateSearchKeyword: (_key: string, fallback: string) => [fallback]
}))

import { getStatusBarToggles } from './appearance-status-bar-search'

describe('getStatusBarToggles', () => {
  it('exposes only the Claude and Codex usage toggles alongside the shell items', () => {
    const ids = getStatusBarToggles().map((entry) => entry.id)
    expect(ids).toEqual(expect.arrayContaining(['claude', 'codex']))
    for (const id of ids) {
      expect(id).not.toMatch(/minimax|opencode|gemini|grok|kimi|antigravity/i)
    }
  })

  it('includes Codex usage so Appearance can toggle the default-on status item', () => {
    const codexToggle = getStatusBarToggles().find((entry) => entry.id === 'codex')

    expect(codexToggle).toMatchObject({
      toggleDescription: 'Show Codex token and cost usage for the active workspace.'
    })
    expect(codexToggle?.keywords).toEqual(expect.arrayContaining(['status bar', 'codex', 'usage']))
  })
})
