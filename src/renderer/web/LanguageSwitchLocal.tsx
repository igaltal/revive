import type { ReactNode } from 'react'
import { applyLanguage } from '@/i18n'
import { useT } from '@/i18n/useT'
import { cx } from '@/components/cx'
import type { Language } from '@shared/settings'

export const LANG_STORE = 'revive.lang'

/** Before this device is paired there are no settings yet: the language choice is kept in the browser. */
export function LanguageSwitchLocal(): ReactNode {
  const { t, lang } = useT()
  const pick = (l: Language) => {
    try {
      localStorage.setItem(LANG_STORE, l)
    } catch {
      // private mode
    }
    applyLanguage(l)
  }
  return (
    <div className="inline-flex rounded-[10px] border border-border bg-card p-0.5" role="group" aria-label={t('language.switchLabel')}>
      {(['he', 'en'] as const).map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => pick(l)} className={cx('min-h-[36px] rounded-[8px] px-3 text-sm', lang === l ? 'bg-bg font-medium text-ink' : 'text-muted')}>
          {t(`language.${l}`)}
        </button>
      ))}
    </div>
  )
}
