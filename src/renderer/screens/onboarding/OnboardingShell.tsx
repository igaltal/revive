import type { ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { LanguageSwitch } from '@/components/LanguageSwitch'

/** Full screen views carry the language switch in their top bar. */
export function OnboardingShell({ step, total, children }: { step: number; total: number; children: ReactNode }): ReactNode {
  const { t, tx } = useT()
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-10 py-4">
        <div className="flex items-baseline gap-4">
          <span className="font-display text-2xl font-bold text-accent">{t('app.name')}</span>
          <span className="text-sm text-muted" data-testid="onboarding-step">
            {tx('common.step', { current: step, total })}
          </span>
        </div>
        <div className="w-56">
          <LanguageSwitch />
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-8 px-10 py-12">{children}</div>
      </main>
    </div>
  )
}
