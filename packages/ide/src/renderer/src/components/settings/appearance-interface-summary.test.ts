import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { resolveInterfaceSectionSummary } from './appearance-interface-summary'

// Why: English is the only bundled UI language, so the language setting is
// hidden and the summary lists just theme and font.
describe('resolveInterfaceSectionSummary', () => {
  it('includes theme and font while the language setting is hidden', () => {
    const settings = {
      ...getDefaultSettings('/tmp'),
      theme: 'dark' as const,
      uiLanguage: 'en' as const,
      appFontFamily: 'Inter'
    }

    expect(resolveInterfaceSectionSummary(settings)).toBe('Dark · Inter')
  })

  it('falls back to the default font label when app font is empty', () => {
    const settings = {
      ...getDefaultSettings('/tmp'),
      theme: 'light' as const,
      uiLanguage: 'system' as const,
      appFontFamily: ''
    }

    expect(resolveInterfaceSectionSummary(settings)).toBe('Light · Default font')
  })
})
