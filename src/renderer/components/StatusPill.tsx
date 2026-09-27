import type { ReactNode } from 'react'
import type { RunStatus } from '@shared/runtime'
import { useT } from '@/i18n/useT'
import type { DisplayStatus } from '@/state/runtime'
import { cx } from './cx'

export type StatusKind = 'running' | 'verified' | 'broken' | 'unknown'

const styles: Record<StatusKind | 'busy', { dot: string; text: string }> = {
  running: { dot: 'bg-running', text: 'text-running' },
  verified: { dot: 'bg-verified', text: 'text-verified' },
  broken: { dot: 'bg-broken', text: 'text-broken' },
  unknown: { dot: 'bg-attention', text: 'text-attention' },
  busy: { dot: 'bg-running animate-pulse', text: 'text-running' }
}

const words: Record<StatusKind, string> = {
  running: 'vocab.runningNow',
  verified: 'vocab.checkedAndWorking',
  broken: 'vocab.needsFixing',
  unknown: 'vocab.notCheckedYet'
}

export const phaseKey = (phase: RunStatus) => `run.phase.${phase}`

/** Status is always a word plus a color, never color alone. */
export function StatusPill({ status }: { status: StatusKind | DisplayStatus }): ReactNode {
  const { tx } = useT()
  const d: DisplayStatus = typeof status === 'string' ? { kind: status } : status
  const s = styles[d.kind]
  return (
    <span
      data-status={d.kind}
      data-phase={d.kind === 'busy' ? d.phase : undefined}
      data-testid="status-pill"
      className={cx('inline-flex items-center gap-1.5 rounded-full whitespace-nowrap border border-border bg-card px-2.5 py-1 text-[13px] font-medium', s.text)}
    >
      <span className={cx('size-2 rounded-full', s.dot)} aria-hidden />
      {tx(d.kind === 'busy' ? phaseKey(d.phase) : words[d.kind])}
    </span>
  )
}
