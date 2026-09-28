import { useEffect, useState, type ReactNode } from 'react'
import type { UpdateStatus } from '@shared/update'
import { useT } from '@/i18n/useT'
import { transport } from '@/transport'

/**
 * A small note when a new version is downloaded: it installs when Revive
 * next quits, or now if the person chooses. Never a dialog, never on its own.
 */
export function UpdateNote(): ReactNode {
  const { tx } = useT()
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    let alive = true
    void transport
      .invoke('update:status')
      .then((s) => alive && setStatus(s))
      .catch(() => {})
    const off = transport.subscribe('update:status', (s) => alive && setStatus(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  if (!status || status.state !== 'ready' || hidden) return null
  return (
    <div role="status" data-testid="update-note" className="glass fixed bottom-4 start-4 z-40 flex max-w-sm items-center gap-3 rounded-[12px] px-4 py-2.5 text-sm text-ink shadow-md">
      <span className="size-2 shrink-0 rounded-full bg-running" aria-hidden />
      <span>{tx('update.ready', { version: status.version ?? '' })}</span>
      <button type="button" data-testid="update-install" onClick={() => void transport.invoke('update:install')} className="shrink-0 font-medium text-accent hover:underline">
        {tx('update.restart')}
      </button>
      <button type="button" aria-label={String(tx('update.later'))} onClick={() => setHidden(true)} className="shrink-0 text-muted hover:text-ink">
        ✕
      </button>
    </div>
  )
}
