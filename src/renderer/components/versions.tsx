import { useEffect, useState, type ReactNode } from 'react'
import type { RestorePreview, RestoreResult, VersionSummary } from '@shared/versions'
import { useT } from '@/i18n/useT'
import { LtrBlock } from '@/i18n/bidi'
import { transport } from '@/transport'
import { useProjects } from '@/state/projects'
import { useRuntime } from '@/state/runtime'
import { useVersions, type LastRestore } from '@/state/versions'
import { Dialog } from './Dialog'
import { Button } from './Button'
import { Notice } from './Notice'
import { TechnicalDetails } from './TechnicalDetails'
import { UndoIcon } from './icons'

/** A plain title for a saved version, in the interface language. */
export function VersionTitle({ version, versions }: { version: VersionSummary; versions: VersionSummary[] }): ReactNode {
  const { tx, lang } = useT()
  const name = useProjectName()
  if (version.kind === 'restore') {
    const from = versions.find((v) => v.id === version.restoredFrom)
    if (!from) return tx('history.title.restoreUnknown')
    return version.scope ? tx('history.title.restoreProject', { date: new Date(from.createdAt), name: name(version.scope) }) : tx('history.title.restore', { date: new Date(from.createdAt) })
  }
  if (version.kind === 'undo') return tx('history.title.undo')
  return lang === 'he' ? version.title.he : version.title.en
}

function useProjectName(): (id: string) => string {
  const { manifest } = useProjects()
  return (id) => (manifest?.state === 'ok' ? manifest.manifest.projects.find((p) => p.id === id)?.name : undefined) ?? id
}

/**
 * "Go back to this version?" Asks main what would change first, so the
 * sentence is true: how many files go back, how many move to the trash,
 * and what stops.
 */
export function RestoreDialog({ version, projectId, onClose }: { version: VersionSummary | null; projectId?: string; onClose: () => void }): ReactNode {
  const { t, tx } = useT()
  const name = useProjectName()
  // Answers are kept with the version they belong to, so an old one never shows for a new choice.
  const [answer, setAnswer] = useState<{ id: string; preview?: RestorePreview; problem?: Exclude<RestoreResult, { ok: true }>['code'] } | null>(null)
  const [working, setWorking] = useState(false)
  const current = version && answer?.id === version.id ? answer : null
  const preview = current?.preview ?? null
  const problem = current?.problem ?? null

  useEffect(() => {
    if (!version) return
    let alive = true
    void transport.invoke('versions:preview', { versionId: version.id, ...(projectId ? { projectId } : {}) }).then((p) => {
      if (alive) setAnswer(p ? { id: version.id, preview: p } : { id: version.id, problem: 'not_found' })
    })
    return () => {
      alive = false
    }
  }, [version, projectId])

  const confirm = async () => {
    if (!version) return
    setWorking(true)
    const r = await transport.invoke('versions:restore', { versionId: version.id, ...(projectId ? { projectId } : {}) })
    setWorking(false)
    if (r.ok) onClose()
    else setAnswer({ id: version.id, problem: r.code })
  }

  return (
    <Dialog
      open={version !== null}
      onClose={onClose}
      testId="restore-dialog"
      title={version ? tx('history.restoreDialog.title', { date: new Date(version.createdAt) }) : null}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {tx('common.cancel')}
          </Button>
          <Button data-testid="restore-confirm" disabled={!preview || working || problem !== null} onClick={() => void confirm()}>
            <UndoIcon />
            {tx('vocab.goBackToThisVersion')}
          </Button>
        </>
      }
    >
      {problem ? (
        <p className="text-broken" data-testid="restore-problem">
          {tx(`history.problem.${problem}`)}
        </p>
      ) : !preview ? (
        <p className="text-muted">{tx('history.restoreDialog.loading')}</p>
      ) : (
        <>
          <p data-testid="restore-scope" data-scope={projectId ? 'project' : 'folder'} className="font-medium">
            {projectId ? tx('history.restoreDialog.scopeProject', { name: name(projectId) }) : tx('history.restoreDialog.scopeFolder')}
          </p>
          <p data-testid="restore-summary">
            {tx('history.restoreDialog.changed', { count: preview.changedFiles })}
            {preview.newFiles > 0 ? <> {tx('history.restoreDialog.newFiles', { count: preview.newFiles })}</> : null}
          </p>
          {preview.willStop.length > 0 ? <p>{tx('history.restoreDialog.willStop', { names: preview.willStop.map(name).join(', ') })}</p> : null}
          <p className="text-muted">{tx('history.restoreDialog.safe')}</p>
          {preview.sample.length > 0 ? (
            <TechnicalDetails>
              <LtrBlock label={t('history.restoreDialog.files')}>{preview.sample.join('\n')}</LtrBlock>
            </TechnicalDetails>
          ) : null}
        </>
      )}
    </Dialog>
  )
}

/** After a go back: what happened, Undo, and "start it again" for what was stopped. */
export function RestoreDone({ restore }: { restore: LastRestore }): ReactNode {
  const { tx } = useT()
  const { versions, dismissRestore } = useVersions()
  const { start } = useRuntime()
  const name = useProjectName()
  const [started, setStarted] = useState<string[]>([])
  const target = versions?.find((v) => v.id === restore.versionId)

  const undo = async () => {
    dismissRestore()
    await transport.invoke('versions:undo', { versionId: restore.undoVersionId })
  }

  return (
    <Notice
      tone="ok"
      testId="restore-done"
      actions={
        <>
          <Button data-testid="restore-undo" variant="secondary" onClick={() => void undo()}>
            <UndoIcon />
            {tx('history.undo')}
          </Button>
          <Button variant="quiet" onClick={dismissRestore}>
            {tx('common.close')}
          </Button>
        </>
      }
    >
      <p>
        {restore.how === 'undo'
          ? tx('history.undone', { count: restore.changedFiles })
          : target && restore.projectId
            ? tx('history.doneProject', { name: name(restore.projectId), date: new Date(target.createdAt), count: restore.changedFiles })
            : target
              ? tx('history.done', { date: new Date(target.createdAt), count: restore.changedFiles })
              : tx('history.doneUnknown', { count: restore.changedFiles })}
      </p>
      {restore.stoppedProjects
        .filter((id) => !started.includes(id))
        .map((id) => (
          <div key={id} className="flex flex-wrap items-center gap-3" data-testid="start-again">
            <span>{tx('history.startAgain', { name: name(id) })}</span>
            <Button
              variant="secondary"
              onClick={() => {
                start(id)
                setStarted((s) => [...s, id])
              }}
            >
              {tx('vocab.start')}
            </Button>
          </div>
        ))}
    </Notice>
  )
}

function formatSize(bytes: number, lang: string): string {
  const mb = bytes / (1024 * 1024)
  const nf = (unit: string, v: number) => new Intl.NumberFormat(lang, { style: 'unit', unit, maximumFractionDigits: 1 }).format(v)
  return mb >= 1 ? nf('megabyte', mb) : nf('kilobyte', Math.max(1, bytes / 1024))
}

/** What going back moved aside. Only the user empties it, after confirming. */
export function TrashCard(): ReactNode {
  const { tx, lang } = useT()
  const { trash } = useVersions()
  const [confirming, setConfirming] = useState(false)
  if (!trash) return null

  return (
    <section className="flex flex-col gap-3 rounded-[12px] border border-border bg-card p-5" data-testid="trash">
      <h2 className="text-xl text-ink">{tx('trash.title')}</h2>
      {trash.items === 0 ? (
        <p className="text-[15px] text-muted">{tx('trash.none')}</p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] text-ink">{tx('trash.body', { items: trash.items, size: formatSize(trash.bytes, lang) })}</p>
          <Button variant="secondary" data-testid="trash-empty" onClick={() => setConfirming(true)}>
            {tx('trash.empty')}
          </Button>
        </div>
      )}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        testId="trash-confirm"
        title={tx('trash.confirm.title')}
        actions={
          <>
            <Button variant="quiet" onClick={() => setConfirming(false)}>
              {tx('trash.confirm.keep')}
            </Button>
            <Button
              data-testid="trash-empty-confirm"
              variant="danger"
              onClick={() => {
                setConfirming(false)
                void transport.invoke('trash:empty', { confirm: true })
              }}
            >
              {tx('trash.empty')}
            </Button>
          </>
        }
      >
        <p>{tx('trash.confirm.body', { items: trash.items })}</p>
      </Dialog>
    </section>
  )
}
