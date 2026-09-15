import i18next, { type i18n as I18nInstance, type TOptions } from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import { isPseudoLocalizationLocale, pseudoLocalizeString } from './pseudo-localization'
import { DEFAULT_LOCALE, resolveUiLocale } from './supported-languages'
import { isPluginUiLanguage, type UiLanguage } from '../../../shared/ui-language'
import type { PluginLanguagePackRegistration } from '../../../shared/plugins/plugin-language-pack-artifact'

export const i18n: I18nInstance = i18next.createInstance()

// Why: English is the only bundled UI catalog, so it is seeded eagerly as the
// sole built-in resource. Plugin language packs register their catalogs at
// runtime through setRendererPluginLanguagePacks(), so no lazy backend is
// needed.
void i18n.use(initReactI18next).init({
  fallbackLng: DEFAULT_LOCALE,
  lng: DEFAULT_LOCALE,
  // Why: `partialBundledLanguages` keeps i18next from treating plugin resource
  // languages added later via addResourceBundle() as missing.
  partialBundledLanguages: true,
  resources: {
    en: {
      translation: en
    }
  },
  interpolation: {
    escapeValue: false
  },
  react: {
    useSuspense: false
  }
})

export function translate(key: string, fallback: string, options?: TOptions): string {
  const value = i18n.t(key, { defaultValue: fallback, ...options })
  return isPseudoLocalizationLocale(i18n.language) ? pseudoLocalizeString(value) : value
}

export async function setRendererUiLanguage(language: UiLanguage): Promise<void> {
  const resolved = resolveUiLocale(language)
  const resourceLanguage = resolveRendererResourceLanguage(resolved)
  const locale =
    isPluginUiLanguage(language) && resourceLanguage === resolved
      ? DEFAULT_LOCALE
      : resourceLanguage
  if (i18n.language !== locale) {
    await i18n.changeLanguage(locale)
  }
}

const registeredPluginLanguages = new Set<string>()
let pluginLanguagePacks: readonly PluginLanguagePackRegistration[] = []

/**
 * BCP-47 tag for `Intl` formatting. Plugin catalogs register under a synthetic
 * `plugin<hex>` resource language that `Intl` rejects, so fall back to the tag
 * the pack declares (for example `ru-RU`) and finally to the default locale.
 */
export function getIntlLocale(): string {
  const active = i18n.language
  const pack = pluginLanguagePacks.find((entry) => entry.resourceLanguage === active)
  const candidate = pack?.locale ?? active
  try {
    // Why: an empty result means Intl has no data for the tag, so fall through
    // to the default locale instead of letting Intl pick the runtime one.
    return Intl.DateTimeFormat.supportedLocalesOf(candidate)[0] ?? DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

export function resolveRendererResourceLanguage(language: string): string {
  return pluginLanguagePacks.find((pack) => pack.id === language)?.resourceLanguage ?? language
}

export function setRendererPluginLanguagePacks(
  packs: readonly PluginLanguagePackRegistration[]
): void {
  for (const language of registeredPluginLanguages) {
    i18n.removeResourceBundle(language, 'translation')
  }
  registeredPluginLanguages.clear()
  pluginLanguagePacks = packs
  for (const pack of packs) {
    i18n.addResourceBundle(pack.resourceLanguage, 'translation', pack.catalog, true, true)
    registeredPluginLanguages.add(pack.resourceLanguage)
  }
}
