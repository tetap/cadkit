import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  type Locale,
  type MessageKey,
} from './locales.js'

const STORAGE_KEY = 'cadkit.playground.locale'

let current: Locale = detectInitialLocale()
const listeners = new Set<(locale: Locale) => void>()

function detectInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null
    if (saved && saved in LOCALES) return saved
  } catch {
    /* ignore */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : ''
  if (nav.toLowerCase().startsWith('zh')) return 'zh-CN'
  if (nav.toLowerCase().startsWith('en')) return 'en-US'
  return DEFAULT_LOCALE
}

export function getLocale(): Locale {
  return current
}

export function setLocale(locale: Locale): void {
  if (!(locale in LOCALES) || locale === current) return
  current = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    /* ignore */
  }
  document.documentElement.lang = locale
  for (const fn of listeners) fn(locale)
}

export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function t(key: MessageKey): string {
  return LOCALES[current][key] ?? LOCALES[DEFAULT_LOCALE][key] ?? key
}

export function availableLocales(): Locale[] {
  return Object.keys(LOCALES) as Locale[]
}

export { LOCALE_LABELS, type Locale, type MessageKey }
