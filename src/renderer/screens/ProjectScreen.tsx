import { useState, type ReactNode } from 'react'
import type { Project } from '@shared/manifest'
import type { PreviewDevice } from '@shared/ipc'
import { useT } from '@/i18n/useT'
import { BidiText, LtrBlock } from '@/i18n/bidi'
import { useProjects } from '@/state/projects'
import { displayStatus, useProjectLog, useRuntime } from '@/state/runtime'
import { transport } from '@/transport'
import { StatusPill } from '@/components/StatusPill'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { LogBlock } from '@/components/LogBlock'
import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'
import { RunReason } from '@/components/RunReason'
import { PreviewFrame } from '@/components/PreviewFrame'
import { ProjectPicture, actionKeyFor, localized } from '@/components/ProjectCard'
import { ChevronBack, PlayIcon, UndoIcon } from '@/components/icons'
import { cx } from '@/components/cx'
import { Dialog } from '@/components/Dialog'
import { RestoreDialog, RestoreDone, VersionTitle } from '@/components/versions'
import { useVersions } from '@/state/versions'
import type { VersionSummary } from '@shared/versions'

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl text-ink">{title}</h2>
      {children}
    </section>
  )
}

function DeviceSwitch({ value, onChange }: { value: PreviewDevice; onChange: (d: PreviewDevice) => void }): ReactNode {
  const { tx } = useT()
  return (
    <div className="inline-flex rounded-[10px] border border-border bg-bg p-0.5" role="group">
      {(['desktop', 'phone'] as const).map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={value === d}
          data-testid={`device-${d}`}
          onClick={() => onChange(d)}
          className={cx('min-h-[36px] rounded-[8px] px-3 text-sm font-medium', value === d ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink')}
        >
          {tx(`preview.${d}`)}
        </button>
      ))}
    </div>
  )
}

/** Project page: start and stop, the live preview, a plain description, technical details folded. */
export function ProjectScreen({ projectId, onBack }: { projectId: string; onBack: () => void }): ReactNode {
  const { t, tx, lang } = useT()
  const { manifest } = useProjects()
  const { runs, shots, start, stop } = useRuntime()
  const [device, setDevice] = useState<PreviewDevice>('desktop')
  const log = useProjectLog(projectId)
  const { versions, lastRestore } = useVersions()
  const [listOpen, setListOpen] = useState(false)
  const [chosen, setChosen] = useState<VersionSummary | null>(null)
  const project: Project | undefined = manifest?.state === 'ok' ? manifest.manifest.projects.find((p) => p.id === projectId) : undefined

  if (!project) return null
  const run = runs[projectId]
  const status = displayStatus(project, run)
  const live = status.kind === 'running' || status.kind === 'busy'
  const notFound = t('technical.notFound')
  const url = run?.url ?? project.run.url
  const port = run?.port ?? project.run.port

  return (
    <div className="flex max-w-5xl flex-col gap-8" data-testid="project-page">
      <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronBack />
        {tx('vocab.myProjects')}
      </button>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-4xl leading-tight text-ink">
            <bdi>{project.name}</bdi>
          </h1>
          <StatusPill status={status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="quiet" data-testid="project-versions" onClick={() => setListOpen(true)}>
            <UndoIcon />
            {tx('project.versions')}
          </Button>
          {live ? (
            <Button variant="secondary" data-testid="project-stop" disabled={status.kind === 'busy' && status.phase === 'stopping'} onClick={() => stop(projectId)}>
              {tx('vocab.stop')}
            </Button>
          ) : (
            <Button data-testid="project-start" onClick={() => start(projectId)}>
              <PlayIcon />
              {tx(actionKeyFor(status.kind))}
            </Button>
          )}
        </div>
      </header>

      {lastRestore ? <RestoreDone restore={lastRestore} /> : null}

      {status.kind === 'running' ? (
        <div className="flex flex-col overflow-hidden rounded-[12px] border border-border bg-card" data-testid="preview">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
            <DeviceSwitch value={device} onChange={setDevice} />
            <div className="flex items-center gap-2">
              <Button variant="quiet" data-testid="preview-reload" onClick={() => void transport.invoke('preview:reload')}>
                {tx('preview.reload')}
              </Button>
              <Button variant="secondary" data-testid="preview-open" onClick={() => void transport.invoke('preview:openInBrowser', { projectId })}>
                {tx('preview.openInBrowser')}
              </Button>
            </div>
          </div>
          <PreviewFrame projectId={projectId} device={device} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-border bg-card">
          <ProjectPicture project={project} src={shots[projectId]} className={cx('h-72', status.kind === 'busy' && 'opacity-60')} />
          {status.kind === 'busy' ? (
            <div className="flex flex-col gap-3 px-5 py-4" data-testid="run-progress">
              <p className="text-[15px] text-ink">{tx(`run.busy.${status.phase}`)}</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
                <div className="h-full w-1/3 animate-pulse rounded-full bg-running" />
              </div>
            </div>
          ) : (
            <p className="px-5 py-3 text-sm text-muted">{tx(shots[projectId] ? 'project.pictureNote' : 'project.previewSoon')}</p>
          )}
        </div>
      )}

      {run?.reason && !live ? (
        <Notice
          tone={run.status === 'broken' ? 'broken' : 'attention'}
          testId="run-reason"
          actions={
            <Button onClick={() => start(projectId)} data-testid="run-retry">
              {tx('vocab.checkIfItWorks')}
            </Button>
          }
        >
          <p data-code={run.reason.code}>
            <RunReason project={project} reason={run.reason} />
          </p>
        </Notice>
      ) : null}

      <Section title={tx('project.what')}>
        <p className="max-w-2xl text-[17px] leading-relaxed text-ink" data-testid="project-page-description">
          <BidiText text={localized(project.description, lang)} lang={lang} />
        </p>
      </Section>

      <Section title={tx('vocab.keysAndConnections')}>
        {project.keys.length === 0 ? (
          <p className="text-[15px] text-muted">{tx('project.keysNone')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-[12px] border border-border bg-card px-5">
            {project.keys.map((k) => (
              <li key={k.key} className="flex items-center justify-between gap-4 py-3">
                <span className="text-[15px] text-ink">
                  <BidiText text={localized(k.purpose, lang)} lang={lang} />
                </span>
                <span className="text-sm text-muted">{tx(k.required ? 'project.keyNeeded' : 'project.keyOptional')}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <TechnicalDetails>
        <LtrBlock label={t('technical.folder')}>{project.path}</LtrBlock>
        <LtrBlock label={t('technical.stack')}>{project.stack.join(', ') || notFound}</LtrBlock>
        <LtrBlock label={t('technical.install')}>{project.run.install ?? notFound}</LtrBlock>
        <LtrBlock label={t('technical.dev')}>{project.run.dev ?? notFound}</LtrBlock>
        <LtrBlock label={t('technical.port')}>{port ?? notFound}</LtrBlock>
        <LtrBlock label={t('technical.url')}>{url ?? notFound}</LtrBlock>
        {project.keys.length > 0 ? <LtrBlock label={t('technical.keys')}>{project.keys.map((k) => k.key).join('\n')}</LtrBlock> : null}
        {project.notes.length > 0 ? <LogBlock lines={project.notes} label={t('technical.notes')} /> : null}
        {log.length > 0 ? <LogBlock lines={log} label={t('technical.log')} /> : null}
      </TechnicalDetails>

      <Dialog
        open={listOpen}
        onClose={() => setListOpen(false)}
        testId="versions-dialog"
        title={tx('project.versionsTitle')}
        actions={
          <Button variant="quiet" onClick={() => setListOpen(false)}>
            {tx('common.close')}
          </Button>
        }
      >
        <p className="text-muted">{tx('project.versionsNote')}</p>
        {versions && versions.length > 0 ? (
          <ul className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto">
            {versions.slice(0, 8).map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  data-testid="versions-dialog-row"
                  className="flex w-full flex-col items-start gap-0.5 py-3 text-start hover:bg-ink/5"
                  onClick={() => {
                    setListOpen(false)
                    setChosen(v)
                  }}
                >
                  <span className="font-medium text-ink">
                    <VersionTitle version={v} versions={versions} />
                  </span>
                  <span className="text-sm text-muted">{tx('history.when', { date: new Date(v.createdAt) })}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{tx('history.empty')}</p>
        )}
      </Dialog>
      <RestoreDialog version={chosen} projectId={projectId} onClose={() => setChosen(null)} />
    </div>
  )
}
