import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import type { FolderCheck, FolderProblem, RecentFolder } from '@shared/folder'
import { useT } from '@/i18n/useT'
import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'
import { ChevronForward } from '@/components/icons'
import { cx } from '@/components/cx'
import { transport } from '@/transport'

function FolderIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 7.5A1.5 1.5 0 014.5 6h4.2l1.8 2h9a1.5 1.5 0 011.5 1.5v8A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5z" />
    </svg>
  )
}

export function FolderStep({ onChosen, header }: { onChosen: (path: string) => void; header?: ReactNode }): ReactNode {
  const { t, tx } = useT()
  const caps = transport.capabilities()
  const [recent, setRecent] = useState<RecentFolder[]>([])
  const [problem, setProblem] = useState<FolderProblem | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void transport.invoke('folder:recent').then(setRecent)
  }, [])

  const choose = async (path: string) => {
    const result: FolderCheck = await transport.invoke('folder:choose', { path })
    if (result.ok) {
      setProblem(null)
      onChosen(result.path)
    } else {
      setProblem(result.problem)
    }
  }

  const pick = async () => {
    const picked = await transport.invoke('folder:pick')
    if (!picked) return
    if (picked.ok) await choose(picked.path)
    else setProblem(picked.problem)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (transport.pathForFile) void choose(transport.pathForFile(file))
  }

  return (
    <>
      {header ?? (
        <div>
          <h1 className="text-4xl leading-tight text-ink">{tx('folder.title')}</h1>
          <p className="mt-2 text-[15px] text-muted">{tx('folder.subtitle')}</p>
        </div>
      )}

      {caps.dropFolder || caps.folderPicker ? (
        <div
          data-testid="folder-drop"
          onDragOver={
            caps.dropFolder
              ? (e) => {
                  e.preventDefault()
                  setDragging(true)
                }
              : undefined
          }
          onDragLeave={caps.dropFolder ? () => setDragging(false) : undefined}
          onDrop={caps.dropFolder ? onDrop : undefined}
          className={cx(
            'flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-8 py-12 text-center transition-colors',
            dragging ? 'border-ink bg-card' : 'border-border bg-card/60'
          )}
        >
          <span className="text-muted">
            <FolderIcon />
          </span>
          {caps.dropFolder ? <p className="font-display text-xl text-ink">{tx('folder.drop')}</p> : null}
          {caps.dropFolder && caps.folderPicker ? <span className="text-sm text-muted">{tx('folder.or')}</span> : null}
          {caps.folderPicker ? (
            <Button data-testid="folder-pick" onClick={() => void pick()}>
              {tx('folder.choose')}
            </Button>
          ) : null}
        </div>
      ) : (
        // This client can't reach the other computer's dialogs or files: recent folders only.
        <Notice testId="folder-remote">
          <p>{tx('folder.remoteNote')}</p>
        </Notice>
      )}

      {problem ? (
        <Notice testId="folder-problem" tone="broken">
          <p>{tx(`folder.problem.${problem}`)}</p>
        </Notice>
      ) : null}

      {recent.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted">{tx('folder.recent')}</h2>
          <ul className="flex flex-col gap-2">
            {recent.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  disabled={!f.exists}
                  data-testid="recent-folder"
                  onClick={() => void choose(f.path)}
                  className="flex min-h-[42px] w-full items-center justify-between gap-4 rounded-[10px] border border-border bg-card px-4 py-2 text-start hover:border-ink/40 disabled:opacity-60"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[15px] font-medium text-ink">
                      <bdi>{f.name}</bdi>
                    </span>
                    <span dir="ltr" className="truncate text-start font-mono text-xs text-muted">
                      {f.path}
                    </span>
                  </span>
                  {f.exists ? <ChevronForward className="shrink-0 text-muted" /> : <span className="shrink-0 text-sm text-muted">{tx('folder.notFound')}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-[12px] border border-border bg-card p-5" aria-label={t('folder.promises.title')}>
        <h2 className="font-sans text-[15px] font-semibold text-ink">{tx('folder.promises.title')}</h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 ps-5 text-sm leading-relaxed text-ink/80">
          <li>{tx('folder.promises.readOnly')}</li>
          <li>{tx('folder.promises.versions')}</li>
          <li>{tx('folder.promises.noServers')}</li>
        </ul>
      </section>
    </>
  )
}
