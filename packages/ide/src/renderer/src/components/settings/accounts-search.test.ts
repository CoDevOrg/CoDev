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

import { getAccountsPaneSearchEntries } from './accounts-search'

describe('getAccountsPaneSearchEntries', () => {
  it('rolls up only the Claude and Codex account sections', () => {
    const titles = getAccountsPaneSearchEntries().map((entry) => entry.title)
    expect(titles.length).toBeGreaterThan(0)
    for (const title of titles) {
      expect(title).not.toMatch(/minimax|opencode|gemini|grok|kimi|antigravity/i)
    }
  })
})
