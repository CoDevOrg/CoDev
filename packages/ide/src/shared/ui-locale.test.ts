import { describe, expect, it } from 'vitest'

import { normalizeSupportedUiLocale, resolveUiLocale, resolveRendererUiLocale } from './ui-locale'
import { UI_LANGUAGE_ENGLISH, UI_LANGUAGE_SYSTEM } from './ui-language'

describe('ui-locale', () => {
  it('normalizes English locale prefixes', () => {
    expect(normalizeSupportedUiLocale('en-US')).toBe('en')
    expect(normalizeSupportedUiLocale('en')).toBe('en')
  })

  it('falls back every other locale to English', () => {
    expect(normalizeSupportedUiLocale('fr-FR')).toBe('en')
    expect(normalizeSupportedUiLocale('zh-CN')).toBe('en')
    expect(normalizeSupportedUiLocale('ko-KR')).toBe('en')
    expect(normalizeSupportedUiLocale('ja-JP')).toBe('en')
    expect(normalizeSupportedUiLocale('es-MX')).toBe('en')
    expect(normalizeSupportedUiLocale(undefined)).toBe('en')
  })

  it('resolves explicit English independently of system locale', () => {
    expect(resolveUiLocale(UI_LANGUAGE_ENGLISH, 'zh-CN')).toBe('en')
  })

  it('preserves a selected plugin language bundle id', () => {
    expect(resolveUiLocale('plugin:orca-samples.portuguese/pt-BR')).toBe(
      'plugin:orca-samples.portuguese/pt-BR'
    )
  })

  it('maps every system locale to English', () => {
    expect(resolveUiLocale(UI_LANGUAGE_SYSTEM, 'en-GB')).toBe('en')
    expect(resolveUiLocale(UI_LANGUAGE_SYSTEM, 'zh-CN')).toBe('en')
    expect(resolveUiLocale(UI_LANGUAGE_SYSTEM, 'fr-FR')).toBe('en')
  })

  it('resolves renderer languages to English', () => {
    expect(resolveRendererUiLocale(UI_LANGUAGE_ENGLISH)).toBe('en')
    expect(resolveRendererUiLocale(UI_LANGUAGE_SYSTEM)).toBe('en')
  })
})
