import { app } from 'electron'
import i18next, { type i18n as I18nInstance, type TOptions } from 'i18next'

import { isPseudoLocalizationLocale, pseudoLocalizeString } from '../../shared/pseudo-localization'
import { DEFAULT_UI_LOCALE, resolveUiLocale } from '../../shared/ui-locale'
import { UI_LANGUAGE_SYSTEM, type UiLanguage } from '../../shared/ui-language'
import type { PluginLanguagePackRegistration } from '../../shared/plugins/plugin-language-pack-artifact'

export const mainI18n: I18nInstance = i18next.createInstance()

let initialized = false
let pluginLanguagePacks: readonly PluginLanguagePackRegistration[] = []
const registeredPluginLanguages = new Set<string>()

export function getMainSystemLocale(): string {
  try {
    return app.getLocale()
  } catch {
    return DEFAULT_UI_LOCALE
  }
}

export async function ensureMainI18n(): Promise<I18nInstance> {
  if (!initialized) {
    await mainI18n.init({
      fallbackLng: DEFAULT_UI_LOCALE,
      lng: DEFAULT_UI_LOCALE,
      // Why: mark the default locale loaded with an empty resource bundle. Main
      // process English strings come from translateMain() fallbacks, and
      // partialBundledLanguages lets plugin language packs register catalogs
      // later via addResourceBundle() without being treated as missing.
      partialBundledLanguages: true,
      resources: {
        en: {
          translation: {}
        }
      },
      interpolation: {
        escapeValue: false
      }
    })
    initialized = true
    applyMainPluginLanguagePacks()
  }
  return mainI18n
}

export async function setMainUiLanguage(language: UiLanguage): Promise<string> {
  await ensureMainI18n()
  const selectedLocale = resolveUiLocale(
    language,
    language === UI_LANGUAGE_SYSTEM ? getMainSystemLocale() : DEFAULT_UI_LOCALE
  )
  const locale =
    pluginLanguagePacks.find((pack) => pack.id === selectedLocale)?.resourceLanguage ??
    (selectedLocale.startsWith('plugin:') ? DEFAULT_UI_LOCALE : selectedLocale)
  if (mainI18n.language !== locale) {
    await mainI18n.changeLanguage(locale)
  }
  return locale
}

function applyMainPluginLanguagePacks(): void {
  for (const language of registeredPluginLanguages) {
    mainI18n.removeResourceBundle(language, 'translation')
  }
  registeredPluginLanguages.clear()
  for (const pack of pluginLanguagePacks) {
    mainI18n.addResourceBundle(pack.resourceLanguage, 'translation', pack.catalog, true, true)
    registeredPluginLanguages.add(pack.resourceLanguage)
  }
}

export function setMainPluginLanguagePacks(
  packs: readonly PluginLanguagePackRegistration[]
): boolean {
  if (pluginLanguagePacks === packs) {
    return false
  }
  pluginLanguagePacks = packs
  if (initialized) {
    applyMainPluginLanguagePacks()
  }
  return true
}

export function translateMain(key: string, fallback: string, options?: TOptions): string {
  // Why: menu registration can run before async init finishes in tests; fall back
  // to the English default instead of returning undefined from an uninitialized i18n.
  const raw = initialized ? mainI18n.t(key, { defaultValue: fallback, ...options }) : fallback
  const value = typeof raw === 'string' && raw.length > 0 ? raw : fallback
  return isPseudoLocalizationLocale(mainI18n.language) ? pseudoLocalizeString(value) : value
}
