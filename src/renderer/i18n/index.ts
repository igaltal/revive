import i18n from 'i18next'
import ICU from 'i18next-icu'
import { initReactI18next } from 'react-i18next'
import { dirFor, type Language } from '@shared/settings'
import en from './en.json'
import he from './he.json'

export const resources = { en: { translation: en }, he: { translation: he } } as const

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en',
    fallbackLng: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false }
  })

/** Switch words and direction in place. No reload, no remount. */
export function applyLanguage(lang: Language): void {
  const root = document.documentElement
  root.lang = lang
  root.dir = dirFor(lang)
  if (i18n.language !== lang) void i18n.changeLanguage(lang)
}

export default i18n
