import type { ReactNode } from 'react'
import { LANGUAGES } from '@shared/settings'
import { useSettings } from '@/state/settings'
import { useT } from '@/i18n/useT'
import { cx } from './cx'

/** Two option switch: עברית | English. Each option is written in its own language. */
export function LanguageSwitch(): ReactNode {
  const { settings, update } = useSettings()
  const { t } = useT()
  const current = settings.uiLanguage ?? 'en'

  return (
    <div role="radiogroup" aria-label={t('language.switchLabel')} className="grid grid-cols-2 gap-1 rounded-[10px] border border-border bg-bg p-1">
      {LANGUAGES.map((lang) => {
        const selected = current === lang
        return (
          <button
            key={lang}
            type="button"
            role="radio"
            aria-checked={selected}
            lang={lang}
            dir={lang === 'he' ? 'rtl' : 'ltr'}
            data-testid={`lang-${lang}`}
            onClick={() => update({ uiLanguage: lang })}
            className={cx(
              'min-h-[36px] rounded-[8px] text-sm font-medium transition-colors',
              selected ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink'
            )}
          >
            {t(`language.${lang}`)}
          </button>
        )
      })}
    </div>
  )
}
