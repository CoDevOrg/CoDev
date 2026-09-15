import { beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '@/i18n/i18n'
import { searchKeywords, translateSearchKeyword } from './settings-search-keywords'

describe('settings-search-keywords', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('returns only localized text in English UI', async () => {
    await i18n.changeLanguage('en')
    expect(translateSearchKeyword('settings.appearance.language.title', 'Language')).toEqual([
      'Language'
    ])
  })

  it('deduplicates repeated keyword variants', () => {
    expect(searchKeywords(['terminal', 'terminal', { key: 'k', fallback: 'terminal' }])).toEqual([
      'terminal'
    ])
  })

})
