import type { ReactNode } from 'react'
import { cx } from './cx'

export interface Option<V extends string> {
  value: V
  label: ReactNode
  hint?: ReactNode
  aside?: ReactNode
  lang?: string
  dir?: 'rtl' | 'ltr'
}

const COLUMNS = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 min-[640px]:grid-cols-4',
  5: 'grid-cols-2 min-[640px]:grid-cols-5'
} as const

/** A radio group drawn as cards. */
export function OptionCards<V extends string>({
  label,
  value,
  options,
  onChange,
  columns = 2,
  testId
}: {
  label: string
  value: V
  options: Option<V>[]
  onChange: (v: V) => void
  columns?: 2 | 3 | 4 | 5
  testId?: string
}): ReactNode {
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId} className={cx('grid gap-3', COLUMNS[columns])}>
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={o.value}
            lang={o.lang}
            dir={o.dir}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex min-h-[42px] flex-col items-start gap-1 rounded-[10px] border bg-card px-4 py-3 text-start transition-colors',
              selected ? 'border-ink ring-1 ring-ink' : 'border-border hover:border-ink/40'
            )}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="text-[15px] font-medium text-ink">{o.label}</span>
              {o.aside ? <span className="text-sm text-muted">{o.aside}</span> : null}
            </span>
            {o.hint ? <span className="text-[13px] leading-snug text-muted">{o.hint}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
