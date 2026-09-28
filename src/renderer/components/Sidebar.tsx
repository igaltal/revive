import type { ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { LanguageSwitch } from './LanguageSwitch'
import { ConnectionPill } from './host'
import { ClockIcon, GearIcon, GridIcon } from './icons'
import { cx } from './cx'

export type Route = 'projects' | 'history' | 'settings'

const items: Array<{ route: Route; key: string; icon: ReactNode }> = [
  { route: 'projects', key: 'vocab.myProjects', icon: <GridIcon /> },
  { route: 'history', key: 'vocab.history', icon: <ClockIcon /> },
  { route: 'settings', key: 'vocab.settings', icon: <GearIcon /> }
]

export function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }): ReactNode {
  const { t, tx } = useT()
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-6 border-e border-border bg-bg px-4 py-6 max-[639px]:w-full max-[639px]:flex-row max-[639px]:flex-wrap max-[639px]:items-center max-[639px]:gap-2 max-[639px]:border-e-0 max-[639px]:border-b max-[639px]:px-3 max-[639px]:py-2">
      <div className="px-2">
        <div className="font-display text-2xl font-bold tracking-tight text-accent">{t('app.name')}</div>
        <div className="mt-1 text-xs leading-snug text-muted max-[639px]:hidden">{tx('app.tagline')}</div>
      </div>

      <nav aria-label={t('nav.label')} className="flex flex-col gap-1 max-[639px]:order-last max-[639px]:w-full max-[639px]:flex-row max-[639px]:justify-between">
        {items.map((item) => {
          const active = route === item.route
          return (
            <button
              key={item.route}
              type="button"
              data-testid={`nav-${item.route}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => onNavigate(item.route)}
              className={cx(
                'flex min-h-[42px] items-center gap-3 rounded-[10px] px-3 text-start text-[15px] transition-colors max-[639px]:flex-1 max-[639px]:justify-center max-[639px]:gap-1.5 max-[639px]:whitespace-nowrap max-[639px]:px-2 max-[639px]:text-sm',
                active ? 'bg-card font-medium text-ink shadow-sm' : 'text-muted hover:bg-card/60 hover:text-ink'
              )}
            >
              {item.icon}
              {tx(item.key)}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3 max-[639px]:ms-auto max-[639px]:mt-0 max-[639px]:flex-row max-[639px]:items-center">
        <ConnectionPill />
        <LanguageSwitch />
      </div>
    </aside>
  )
}
