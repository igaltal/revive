import type { ReactNode } from 'react'
import { cx } from './cx'

type Tone = 'neutral' | 'attention' | 'broken' | 'ok'

const tones: Record<Tone, string> = {
  neutral: 'border-border bg-card',
  attention: 'border-attention/40 bg-attention/5',
  broken: 'border-broken/40 bg-broken/5',
  ok: 'border-running/40 bg-running/5'
}

/** One plain sentence, one primary action (principle 2). */
export function Notice({
  tone = 'neutral',
  title,
  children,
  actions,
  testId
}: {
  tone?: Tone
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  testId?: string
}): ReactNode {
  return (
    <div data-testid={testId} className={cx('flex flex-col gap-3 rounded-[12px] border p-5 max-[639px]:p-4', tones[tone])}>
      {title ? <h3 className="font-sans text-[17px] font-semibold text-ink">{title}</h3> : null}
      {children ? <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-ink/85">{children}</div> : null}
      {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
    </div>
  )
}
