import { useState, type ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { useSettings } from '@/state/settings'
import { ChevronForward } from './icons'
import { cx } from './cx'

/**
 * Commands, ports, paths and logs live here. Collapsed by default in Simple
 * mode, open by default in Advanced mode. The user can still toggle either way.
 */
export function TechnicalDetails({ children }: { children: ReactNode }): ReactNode {
  const { tx } = useT()
  const { settings } = useSettings()
  const advanced = settings.detailLevel === 'advanced'
  // A manual toggle holds until the detail level changes, then the default applies again.
  const [toggled, setToggled] = useState<{ level: string; open: boolean } | null>(null)
  const open = toggled && toggled.level === settings.detailLevel ? toggled.open : advanced

  return (
    <div className="rounded-[10px] border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setToggled({ level: settings.detailLevel, open: !open })}
        className="flex min-h-[42px] w-full items-center gap-2 px-4 text-start text-sm font-medium text-muted hover:text-ink"
      >
        <ChevronForward className={cx('transition-transform', open && 'rotate-90 rtl:-rotate-90')} />
        {tx('vocab.technicalDetails')}
      </button>
      {open ? <div className="flex flex-col gap-3 border-t border-border px-4 py-3">{children}</div> : null}
    </div>
  )
}
