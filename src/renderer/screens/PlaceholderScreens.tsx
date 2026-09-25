import type { ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { PageHeader } from '@/components/PageHeader'

function EmptyCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center text-muted">
      {children}
    </div>
  )
}

export function HistoryScreen(): ReactNode {
  const { tx } = useT()
  return (
    <div>
      <PageHeader title={tx('vocab.history')} subtitle={tx('history.subtitle')} />
      <EmptyCard>
        <p className="max-w-sm text-[15px]">{tx('history.placeholder')}</p>
        <p className="text-sm">{tx('history.keysNote')}</p>
      </EmptyCard>
    </div>
  )
}
