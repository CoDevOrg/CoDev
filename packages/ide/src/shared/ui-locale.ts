import { UI_LANGUAGE_SYSTEM, isPluginUiLanguage, type UiLanguage } from './ui-language'

export const SUPPORTED_UI_LOCALES = ['en'] as const
export type SupportedUiLocale = (typeof SUPPORTED_UI_LOCALES)[number]

export const DEFAULT_UI_LOCALE: SupportedUiLocale = 'en'

// Why: English is the only bundled catalog, so every built-in language and
// every system locale resolves to it. The signature is kept so callers that
// still pass a system locale tag keep compiling.
export function normalizeSupportedUiLocale(_locale: string | undefined): SupportedUiLocale {
  return DEFAULT_UI_LOCALE
}

export function resolveUiLocale(
  language: UiLanguage,
  systemLocale: string | undefined = DEFAULT_UI_LOCALE
): string {
  if (isPluginUiLanguage(language)) {
    return language
  }
  return normalizeSupportedUiLocale(systemLocale)
}

export function getRendererSystemLocale(): string {
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language
  }
  return DEFAULT_UI_LOCALE
}

export function resolveRendererUiLocale(language: UiLanguage): string {
  return resolveUiLocale(
    language,
    language === UI_LANGUAGE_SYSTEM ? getRendererSystemLocale() : DEFAULT_UI_LOCALE
  )
}
