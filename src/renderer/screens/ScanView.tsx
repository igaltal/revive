import type { ReactNode } from 'react'
import { UNDERSTAND_BATCH, UNDERSTAND_LIMITS, type ScanProjectState } from '@shared/scan'
import { useT } from '@/i18n/useT'
import { LtrBlock } from '@/i18n/bidi'
import { useProjects } from '@/state/projects'
import { useSettings } from '@/state/settings'
import { FullScreen } from '@/components/FullScreen'
import { Button } from '@/components/Button'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { cx } from '@/components/cx'

const STATE_STYLE: Record<ScanProjectState, { dot: string; text: string }> = {
  found: { dot: 'bg-idle', text: 'text-muted' },
  waiting: { dot: 'bg-idle', text: 'text-muted' },
  reading: { dot: 'bg-running animate-pulse', text: 'text-running' },
  done: { dot: 'bg-running', text: 'text-running' },
  unchanged: { dot: 'bg-verified', text: 'text-verified' },
  failed: { dot: 'bg-attention', text: 'text-attention' }
}

/**
 * Reading a folder: every project by name as it's found, then each one's
 * own progress while Claude puts it into words, with the cost as it goes.
 */
export function ScanView(): ReactNode {
  const { t, tx } = useT()
  const { scan, cancelScan } = useProjects()
  const { settings } = useSettings()
  const p = scan?.progress
  const phase = p?.phase ?? 'finding'
  const projects = p?.projects ?? []
  const unchanged = projects.filter((r) => r.state === 'unchanged').length
  const cloud = projects.reduce((n, r) => n + r.cloudOnly, 0)
  const total = p?.toUnderstand ?? 0
  const finished = projects.filter((r) => r.state === 'done' || r.state === 'failed').length
  const fraction = phase === 'understanding' && total > 0 ? finished / total : phase === 'checking' || phase === 'done' ? 1 : null

  return (
    <FullScreen>
      <div className="flex flex-col gap-3">
        <span data-testid="scan-badge" className="inline-flex w-fit items-center gap-2 rounded-full border border-running/40 bg-running/5 px-3 py-1 text-sm font-medium text-running">
          <span className="size-2 rounded-full bg-running" aria-hidden />
          {tx('scan.badge')}
        </span>
        <h1 className="text-4xl leading-tight text-ink max-[639px]:text-3xl">{tx('scan.title')}</h1>
        <p data-testid="scan-phase" data-phase={phase} className="text-[15px] text-ink/80">
          {tx(`scan.phase.${phase}`)}
        </p>
      </div>

      <div
        className="h-2 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label={t('scan.title')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
        data-testid="scan-progress"
      >
        {fraction === null ? <div className="h-full w-1/3 animate-pulse rounded-full bg-running/70" /> : <div className="h-full rounded-full bg-running transition-[width] duration-500" style={{ width: `${Math.max(4, fraction * 100)}%` }} />}
      </div>

      <dl className="grid grid-cols-3 gap-3 max-[639px]:grid-cols-1" data-testid="scan-counts">
        <div className="rounded-[12px] border border-border bg-card p-4">
          <dt className="text-sm text-muted">{tx('scan.count.found')}</dt>
          <dd className="font-display text-3xl text-ink tabular-nums" data-testid="scan-found-count">
            {projects.length}
          </dd>
        </div>
        <div className="rounded-[12px] border border-border bg-card p-4">
          <dt className="text-sm text-muted">{tx('scan.count.describing')}</dt>
          <dd className="font-display text-3xl text-ink tabular-nums">
            {phase === 'finding' ? '–' : `${finished} / ${total}`}
          </dd>
          {unchanged > 0 ? <dd className="mt-1 text-sm text-muted">{tx('scan.count.unchanged', { count: unchanged })}</dd> : null}
        </div>
        <div className="rounded-[12px] border border-border bg-card p-4" data-testid="scan-cost-live">
          <dt className="text-sm text-muted">{tx('scan.count.cost')}</dt>
          <dd className="font-display text-3xl text-ink tabular-nums">{p?.costUsd != null ? tx('scan.money', { cost: p.costUsd }) : tx('scan.money', { cost: 0 })}</dd>
          {p?.estimateUsd != null ? <dd className="mt-1 text-sm text-muted">{tx('scan.estimate', { cost: p.estimateUsd })}</dd> : null}
        </div>
      </dl>

      {cloud > 0 ? (
        <p className="text-sm text-muted" data-testid="scan-cloud">
          {tx('scan.cloud', { count: cloud })}
        </p>
      ) : null}

      {projects.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-[12px] border border-border bg-card" data-testid="scan-found">
          {projects.map((r) => {
            const s = STATE_STYLE[r.state]
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5" data-testid="scan-project" data-state={r.state}>
                <span className={cx('size-2.5 shrink-0 rounded-full', s.dot)} aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <bdi className="truncate text-[15px] font-medium text-ink" dir="auto">
                    {r.name}
                  </bdi>
                  <span className="truncate font-mono text-xs text-muted" dir="ltr">
                    {r.path === '.' ? t('scan.rootProject') : r.path}
                  </span>
                </span>
                <span className={cx('shrink-0 text-sm', s.text)}>{tx(`scan.state.${r.state}`)}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-[15px] text-muted">{tx('scan.looking')}</p>
      )}

      <TechnicalDetails>
        <LtrBlock label={t('scan.limits')}>
          {[
            `finding       on this computer, no AI; secret files never opened; iCloud-only files never downloaded`,
            `describing    ${settings.scanModel}, ${UNDERSTAND_BATCH.size} projects per call, ${UNDERSTAND_BATCH.parallel} calls at once`,
            `each call     no tools, no files (a summary only), max ${UNDERSTAND_LIMITS.maxTurns} turns, max $${UNDERSTAND_LIMITS.maxBudgetUsd}, ${UNDERSTAND_LIMITS.timeoutMs / 60_000} min`,
            `writes        .revive/manifest.json and .revive/scan-state.json only`
          ].join('\n')}
        </LtrBlock>
      </TechnicalDetails>

      <div>
        <Button variant="secondary" data-testid="scan-stop" onClick={cancelScan} disabled={!scan}>
          {tx('scan.stop')}
        </Button>
      </div>
    </FullScreen>
  )
}
