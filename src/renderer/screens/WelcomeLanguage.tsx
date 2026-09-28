import type { ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { useSettings } from '@/state/settings'
import { ArrowForward } from '@/components/icons'
import { LANGUAGES } from '@shared/settings'

/** First run: language before anything else. Each choice is written in its own language. */
export function WelcomeLanguage(): ReactNode {
  const { t } = useT()
  const { update } = useSettings()

  return (
    <main className="flex h-full flex-col items-center justify-center gap-10 px-8">
      <div className="font-display text-3xl font-bold text-accent">{t('app.name')}</div>
      <div className="grid w-full max-w-2xl grid-cols-2 gap-5">
        {LANGUAGES.map((lang) => (
          <button
            key={lang}
            type="button"
            lang={lang}
            dir={lang === 'he' ? 'rtl' : 'ltr'}
            data-testid={`welcome-${lang}`}
            onClick={() => update({ uiLanguage: lang })}
            className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-7 text-start transition-colors hover:border-ink"
          >
            <span className="font-display text-2xl leading-snug text-ink">{t('welcome.title', { lng: lang })}</span>
            <span className="text-sm text-muted">{t('welcome.subtitle', { lng: lang })}</span>
            <span className="mt-4 inline-flex min-h-[42px] items-center gap-2 rounded-[10px] bg-primary px-4 text-[15px] font-medium text-on-primary">
              {t('welcome.continueIn', { lng: lang })}
              <ArrowForward />
            </span>
          </button>
        ))}
      </div>
    </main>
  )
}
