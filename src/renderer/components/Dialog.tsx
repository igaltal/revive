import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useOverlay } from '@/state/overlay'

/**
 * The one modal dialog. It goes through useOverlay, so the live preview is
 * pictured and hidden before the dialog draws, and comes back after.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  testId
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children?: ReactNode
  actions: ReactNode
  testId?: string
}): ReactNode {
  const ready = useOverlay(open)
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ready) return
    panel.current?.querySelector<HTMLElement>('button')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready, onClose])

  if (!ready) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid={testId} className="flex w-full max-w-lg flex-col gap-4 rounded-[14px] border border-border bg-card p-6 shadow-xl">
        <h2 id={titleId} className="text-2xl leading-snug text-ink">
          {title}
        </h2>
        {children ? <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-ink/85">{children}</div> : null}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">{actions}</div>
      </div>
    </div>
  )
}
