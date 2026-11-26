// i18n/index.ts — application i18n setup.
//
// Locale resolution order:
//   1. the value the user picked last (localStorage)
//   2. the browser's preferred languages (any zh* locale → Simplified Chinese)
//   3. English
//
// The chosen locale is also mirrored onto <html lang> so screen readers and
// the browser's own language-sensitive features follow the UI.

import { createI18n } from 'vue-i18n'
import en from './locales/en'
import zhCN from './locales/zh-CN'

export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
}

const LOCALE_STORAGE_KEY = 'arkeep:locale'

function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

export function detectLocale(): AppLocale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isAppLocale(stored)) return stored
  } catch {
    // localStorage can be unavailable (private mode, embedded webviews).
  }

  const languages =
    typeof navigator === 'undefined'
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language]

  if (languages.some((lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('zh'))) {
    return 'zh-CN'
  }
  return 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: { en, 'zh-CN': zhCN },
  // Chinese does not inflect plurals: every plural message has a single form.
  pluralizationRules: { 'zh-CN': () => 0 },
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
})

export function currentLocale(): AppLocale {
  return i18n.global.locale.value as AppLocale
}

export function setLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
  document.documentElement.lang = locale
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Persisting the choice is best effort.
  }
}

document.documentElement.lang = currentLocale()
