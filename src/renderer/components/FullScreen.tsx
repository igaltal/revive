import type { ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { LanguageSwitch } from './LanguageSwitch'

/** Full screen views (onboarding, scan) carry the language switch in their top bar. */
export function FullScreen({ label, children }: { label?: ReactNode; children: ReactNode }): ReactNode {
  const { t } = useT()
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-10 py-4 max-[639px]:px-4 max-[639px]:py-3">
        <div className="flex items-baseline gap-4">
          <span className="font-display text-2xl font-bold text-accent">{t('app.name')}</span>
          {label ? <span className="text-sm text-muted">{label}</span> : null}
        </div>
        <div className="w-56 max-[639px]:w-40">
          <LanguageSwitch />
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-8 px-10 py-12 max-[639px]:gap-6 max-[639px]:px-4 max-[639px]:py-6">{children}</div>
      </main>
    </div>
  )
}
