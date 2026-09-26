import type { ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { cx } from './cx'

export type StatusKind = 'running' | 'verified' | 'broken' | 'unknown'

const styles: Record<StatusKind, { dot: string; text: string; key: string }> = {
  running: { dot: 'bg-running', text: 'text-running', key: 'vocab.runningNow' },
  verified: { dot: 'bg-verified', text: 'text-verified', key: 'vocab.checkedAndWorking' },
  broken: { dot: 'bg-broken', text: 'text-broken', key: 'vocab.needsFixing' },
  unknown: { dot: 'bg-attention', text: 'text-attention', key: 'vocab.notCheckedYet' }
}

/** Status is always a word plus a color, never color alone. */
export function StatusPill({ status }: { status: StatusKind }): ReactNode {
  const { tx } = useT()
  const s = styles[status]
  return (
    <span
      data-status={status}
      className={cx('inline-flex items-center gap-1.5 rounded-full whitespace-nowrap border border-border bg-card px-2.5 py-1 text-[13px] font-medium', s.text)}
    >
      <span className={cx('size-2 rounded-full', s.dot)} aria-hidden />
      {tx(s.key)}
    </span>
  )
}
