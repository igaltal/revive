import type { ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { useSettings } from '@/state/settings'
import { LANGUAGES } from '@shared/settings'
import { LanguageSwitch } from './LanguageSwitch'
import { ConnectionPill } from './host'
import { ClockIcon, GearIcon, GridIcon, HomeIcon } from './icons'
import { cx } from './cx'

export type Route = 'home' | 'projects' | 'history' | 'settings'

export const NAV_ITEMS: Array<{ route: Route; key: string; icon: (size: number) => ReactNode }> = [
  { route: 'home', key: 'vocab.home', icon: (s) => <HomeIcon width={s} height={s} /> },
  { route: 'projects', key: 'vocab.myProjects', icon: (s) => <GridIcon width={s} height={s} /> },
  { route: 'history', key: 'vocab.history', icon: (s) => <ClockIcon width={s} height={s} /> },
  { route: 'settings', key: 'vocab.settings', icon: (s) => <GearIcon width={s} height={s} /> }
]

/** Paper: the sidebar as it was (a top bar on phones), with Home one click away. */
export function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }): ReactNode {
  const { t, tx } = useT()
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-6 border-e border-border bg-bg px-4 py-6 max-[639px]:w-full max-[639px]:flex-row max-[639px]:flex-wrap max-[639px]:items-center max-[639px]:gap-2 max-[639px]:border-e-0 max-[639px]:border-b max-[639px]:px-3 max-[639px]:py-2">
      <div className="px-2">
        <div className="font-display text-2xl font-bold tracking-tight text-accent">{t('app.name')}</div>
        <div className="mt-1 text-xs leading-snug text-muted max-[639px]:hidden">{tx('app.tagline')}</div>
      </div>

      <nav aria-label={t('nav.label')} className="flex flex-col gap-1 max-[639px]:order-last max-[639px]:w-full max-[639px]:flex-row max-[639px]:justify-between">
        {NAV_ITEMS.map((item) => {
          const active = route === item.route
          return (
            <button
              key={item.route}
              type="button"
              data-testid={`nav-${item.route}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => onNavigate(item.route)}
              className={cx(
                'flex min-h-[42px] items-center gap-3 rounded-[10px] px-3 text-start text-[15px] transition-colors max-[639px]:flex-1 max-[639px]:justify-center max-[639px]:gap-1.5 max-[639px]:whitespace-nowrap max-[639px]:px-1.5 max-[639px]:text-sm',
                active ? 'bg-card font-medium text-ink shadow-sm' : 'text-muted hover:bg-card/60 hover:text-ink'
              )}
            >
              <span className="max-[639px]:hidden">{item.icon(18)}</span>
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

/** Scenic on a computer: the glass rail of the design, icons only (named for screen readers and on hover). */
export function Rail({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }): ReactNode {
  const { t } = useT()
  return (
    <nav aria-label={t('nav.label')} data-testid="nav-rail" className="glass flex w-[76px] shrink-0 flex-col items-center gap-2.5 rounded-[24px] py-3.5 max-[639px]:hidden">
      {NAV_ITEMS.map((item) => {
        const active = route === item.route
        return (
          <button
            key={item.route}
            type="button"
            data-testid={`nav-${item.route}`}
            aria-current={active ? 'page' : undefined}
            aria-label={t(item.key)}
            title={t(item.key)}
            onClick={() => onNavigate(item.route)}
            className={cx('flex size-12 items-center justify-center rounded-[14px] transition-colors', active ? 'bg-ink/15 text-accent' : 'text-ink/80 hover:bg-ink/10 hover:text-ink')}
          >
            {item.icon(22)}
          </button>
        )
      })}
      <div className="flex-1" />
      <RailLanguage />
    </nav>
  )
}

/** The language, one tap: each option in its own language. */
function RailLanguage(): ReactNode {
  const { settings, update } = useSettings()
  const { t } = useT()
  const current = settings.uiLanguage ?? 'en'
  return (
    <div role="radiogroup" aria-label={t('language.switchLabel')} className="flex flex-col gap-1">
      {LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          role="radio"
          aria-checked={current === lang}
          aria-label={t(`language.${lang}`)}
          lang={lang}
          data-testid={`lang-${lang}`}
          onClick={() => update({ uiLanguage: lang })}
          className={cx('flex size-10 items-center justify-center rounded-full text-[13px] font-medium', current === lang ? 'bg-ink/15 text-ink' : 'text-muted hover:text-ink')}
        >
          {lang === 'he' ? 'עב' : 'EN'}
        </button>
      ))}
    </div>
  )
}

/** Scenic on a phone: the tab bar at the bottom, as in the phone design. */
export function TabBar({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }): ReactNode {
  const { t, tx } = useT()
  return (
    <nav aria-label={t('nav.label')} data-testid="nav-tabs" className="glass fixed start-3 end-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 grid h-16 grid-cols-4 rounded-[22px] min-[640px]:hidden">
      {NAV_ITEMS.map((item) => {
        const active = route === item.route
        return (
          <button
            key={item.route}
            type="button"
            data-testid={`nav-${item.route}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate(item.route)}
            className={cx('flex flex-col items-center justify-center gap-0.5 text-[11px] whitespace-nowrap', active ? 'text-accent' : 'text-ink/80')}
          >
            {item.icon(22)}
            {tx(item.key)}
          </button>
        )
      })}
    </nav>
  )
}

/** Scenic on a phone, above every screen but Home: the name, the connection and the language. */
export function PhoneTopBar(): ReactNode {
  const { t } = useT()
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 min-[640px]:hidden">
      <span className="text-xl font-semibold text-on-scene">{t('app.name')}</span>
      <div className="flex items-center gap-2">
        <ConnectionPill />
        <div className="w-36">
          <LanguageSwitch />
        </div>
      </div>
    </div>
  )
}
