import { useState, type ReactNode } from 'react'
import type { SessionsInfo } from '@shared/contract'
import { useT } from '@/i18n/useT'
import { transport } from '@/transport'
import { Button } from './Button'
import { Dialog } from './Dialog'

/** Sessions left running for projects that aren't in the list any more. Revive never ends them on its own. */
export function SessionsCleanup({ orphans: initial }: { orphans: SessionsInfo['orphans'] }): ReactNode {
  const { t, tx } = useT()
  const [orphans, setOrphans] = useState(initial)
  const [ending, setEnding] = useState<string | null>(null)
  if (orphans.length === 0) return null
  return (
    <div className="flex flex-col gap-2" data-testid="sessions-cleanup">
      <h3 className="font-medium text-ink">{tx('sessions.orphans.title')}</h3>
      <p className="text-sm text-muted">{tx('sessions.orphans.hint')}</p>
      <ul className="divide-y divide-border rounded-[12px] border border-border bg-card px-5">
        {orphans.map((o) => (
          <li key={o.name} className="flex flex-wrap items-center justify-between gap-3 py-2.5" data-testid="orphan-row">
            <span className="text-[15px] text-ink">
              <bdi>{o.projectId ?? o.name}</bdi>
              {o.kind ? <span className="text-muted"> · {t(`terminal.kind.${o.kind}`)}</span> : null}
            </span>
            <Button variant="secondary" data-testid="orphan-end" onClick={() => setEnding(o.name)}>
              {tx('sessions.orphans.end')}
            </Button>
          </li>
        ))}
      </ul>
      <Dialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        testId="orphan-confirm"
        title={tx('sessions.orphans.confirmTitle')}
        actions={
          <>
            <Button variant="quiet" onClick={() => setEnding(null)}>
              {tx('common.cancel')}
            </Button>
            <Button
              data-testid="orphan-end-confirm"
              variant="danger"
              onClick={() => {
                const name = ending
                setEnding(null)
                if (name) void transport.invoke('sessions:endOrphan', { name, confirm: true }).then((info) => setOrphans(info.orphans))
              }}
            >
              {tx('sessions.orphans.end')}
            </Button>
          </>
        }
      >
        <p>{tx('sessions.orphans.confirmBody')}</p>
      </Dialog>
    </div>
  )
}
