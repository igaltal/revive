import type { ReactNode } from 'react'
import { DESCRIBE_LIMITS, DESCRIBE_MODEL, SCAN_LIMITS } from '@shared/scan'
import { useT } from '@/i18n/useT'
import { LtrBlock } from '@/i18n/bidi'
import { useProjects } from '@/state/projects'
import { useSettings } from '@/state/settings'
import { FullScreen } from '@/components/FullScreen'
import { Button } from '@/components/Button'
import { LogBlock } from '@/components/LogBlock'
import { TechnicalDetails } from '@/components/TechnicalDetails'

/** First scan and every rescan: progress in human terms, projects appearing as they are found. */
export function ScanView(): ReactNode {
  const { t, tx } = useT()
  const { scan, cancelScan } = useProjects()
  const { settings } = useSettings()
  const p = scan?.progress
  const phase = p?.phase ?? 'saving'
  const found = p?.projectsFound ?? []
  // Claude reports a file when it has finished reading it, and it usually starts with a
  // folder-wide listing. Until the first file arrives, say what's happening instead of "0".
  const warmingUp = (p?.filesRead ?? 0) === 0 && (phase === 'saving' || phase === 'reading')

  return (
    <FullScreen>
      <div className="flex flex-col gap-3">
        <span data-testid="scan-badge" className="inline-flex w-fit items-center gap-2 rounded-full border border-running/40 bg-running/5 px-3 py-1 text-sm font-medium text-running">
          <span className="size-2 rounded-full bg-running" aria-hidden />
          {tx('scan.badge')}
        </span>
        <h1 className="text-4xl leading-tight text-ink">{tx('scan.title')}</h1>
        <p data-testid="scan-phase" data-phase={phase} className="text-[15px] text-ink/80">
          {tx(`scan.phase.${phase}`)} <span className="text-muted">{phase === 'reading' ? tx('scan.timeNote') : null}</span>
        </p>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
        <div className="h-full w-1/3 animate-pulse rounded-full bg-ink/70" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-[12px] border border-border bg-card p-5">
          {warmingUp ? (
            <div className="flex flex-col gap-3" data-testid="scan-files" data-state="waiting">
              <div className="font-display text-3xl text-ink">{tx('scan.warmingUp')}</div>
              <div className="h-1 overflow-hidden rounded-full bg-border" aria-hidden>
                <div className="h-full w-1/4 animate-pulse rounded-full bg-running" />
              </div>
            </div>
          ) : (
            <div className="font-display text-3xl text-ink" data-testid="scan-files" data-state="counting">
              {tx('scan.filesRead', { count: p?.filesRead ?? 0 })}
            </div>
          )}
        </div>
        <div className="rounded-[12px] border border-border bg-card p-5">
          <div className="font-display text-3xl text-ink">{tx('scan.projectsFound', { count: found.length })}</div>
        </div>
      </div>

      {found.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 min-[1280px]:grid-cols-3" data-testid="scan-found">
          {found.map((dir) => (
            <li key={dir} className="rounded-[10px] border border-border bg-card px-4 py-3 text-[15px] font-medium text-ink">
              {dir === '.' ? tx('scan.rootProject') : <bdi>{dir}</bdi>}
            </li>
          ))}
        </ul>
      ) : null}

      {p && p.recent.length > 0 ? <LogBlock label={t('scan.recent')} lines={p.recent} /> : null}

      <TechnicalDetails>
        <LtrBlock label={t('scan.limits')}>
          {[
            `model        ${settings.scanModel}`,
            `max turns    ${SCAN_LIMITS.maxTurns}`,
            `max budget   $${SCAN_LIMITS.maxBudgetUsd}`,
            `time limit   ${SCAN_LIMITS.timeoutMs / 60_000} min`,
            `tools        Read, Glob, Write/Edit (.revive/manifest.json only)`,
            ``,
            `descriptions ${DESCRIBE_MODEL}, no tools, max turns ${DESCRIBE_LIMITS.maxTurns}, max $${DESCRIBE_LIMITS.maxBudgetUsd}`
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
