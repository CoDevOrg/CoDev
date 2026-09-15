import { DEFAULT_UI_LOCALE, resolveRendererUiLocale } from '../../../shared/ui-locale'
import {
  UI_LANGUAGE_ENGLISH,
  UI_LANGUAGE_SYSTEM,
  type BuiltInUiLanguage,
  type UiLanguage
} from '../../../shared/ui-language'

export const DEFAULT_LOCALE = DEFAULT_UI_LOCALE

// Why: English is the only bundled UI language, so there is nothing to choose
// and the Appearance settings dropdown stays hidden.
export const SHOW_UI_LANGUAGE_SETTING = false

export type UiLanguageChoice = {
  value: BuiltInUiLanguage
  labelKey: string
}

export const UI_LANGUAGE_CHOICES: UiLanguageChoice[] = [
  { value: UI_LANGUAGE_SYSTEM, labelKey: 'settings.appearance.language.system' },
  { value: UI_LANGUAGE_ENGLISH, labelKey: 'settings.appearance.language.english' }
]

const UI_LANGUAGE_CHOICE_FALLBACKS: Record<BuiltInUiLanguage, string> = {
  [UI_LANGUAGE_SYSTEM]: 'System',
  [UI_LANGUAGE_ENGLISH]: 'English'
}

export function getUiLanguageChoiceLabel(
  choice: UiLanguageChoice,
  translateFn: (key: string, fallback: string) => string
): string {
  return translateFn(choice.labelKey, UI_LANGUAGE_CHOICE_FALLBACKS[choice.value])
}

export function resolveUiLocale(language: UiLanguage): string {
  return resolveRendererUiLocale(language)
}
