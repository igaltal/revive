import { useState, type ReactNode } from 'react'
import type { VersionSummary } from '@shared/versions'
import { useT } from '@/i18n/useT'
import { transport } from '@/transport'
import { useVersions } from '@/state/versions'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { ClockIcon, UndoIcon } from '@/components/icons'
import { RestoreDialog, RestoreDone, TrashCard, VersionTitle } from '@/components/versions'

/** Every saved version with a plain title and a time; one click to go back, and a way to undo it. */
export function HistoryScreen(): ReactNode {
  const { tx } = useT()
  const { versions, lastRestore } = useVersions()
  const [chosen, setChosen] = useState<VersionSummary | null>(null)
  const [saving, setSaving] = useState(false)

  const saveNow = async () => {
    setSaving(true)
    await transport.invoke('versions:save').finally(() => setSaving(false))
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={tx('vocab.history')}
        subtitle={tx('history.subtitle')}
        actions={
          <Button variant="secondary" data-testid="version-save" disabled={saving} onClick={() => void saveNow()}>
            {tx('history.saveNow')}
          </Button>
        }
      />

      {lastRestore ? <RestoreDone restore={lastRestore} /> : null}

      {versions && versions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center text-[15px] text-muted">{tx('history.empty')}</div>
      ) : null}

      {versions && versions.length > 0 ? (
        <ol className="divide-y divide-border rounded-[12px] border border-border bg-card" data-testid="versions">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4" data-testid="version-row" data-kind={v.kind}>
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 text-muted">{v.kind === 'restore' || v.kind === 'undo' ? <UndoIcon /> : <ClockIcon />}</span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-medium text-ink" data-testid="version-title">
                    <VersionTitle version={v} versions={versions} />
                  </span>
                  <span className="text-sm text-muted">{tx('history.when', { date: new Date(v.createdAt) })}</span>
                </div>
              </div>
              <Button variant="secondary" data-testid="version-restore" onClick={() => setChosen(v)}>
                {tx('vocab.goBackToThisVersion')}
              </Button>
            </li>
          ))}
        </ol>
      ) : null}

      <TrashCard />
      <p className="text-sm text-muted">{tx('history.keysNote')}</p>

      <RestoreDialog version={chosen} onClose={() => setChosen(null)} />
    </div>
  )
}
