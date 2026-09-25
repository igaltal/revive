import { useTranslation } from 'react-i18next'
import { createElement, type ReactNode } from 'react'
import { BidiText } from './bidi'

/**
 * `t` returns a plain string (for attributes).
 * `tx` returns bidi-safe React content (for visible text).
 */
export function useT() {
  const { t, i18n } = useTranslation()
  const tx = (key: string, values?: Record<string, unknown>): ReactNode =>
    createElement(BidiText, { text: t(key, values), lang: i18n.language })
  return { t, tx, lang: i18n.language }
}
