import type { ReactNode } from 'react'
import type { Project } from '@shared/manifest'
import { useT } from '@/i18n/useT'
import { BidiText, LtrBlock } from '@/i18n/bidi'
import { useProjects } from '@/state/projects'
import { StatusPill } from '@/components/StatusPill'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { LogBlock } from '@/components/LogBlock'
import { ProjectPicture, localized } from '@/components/ProjectCard'
import { ChevronBack } from '@/components/icons'

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl text-ink">{title}</h2>
      {children}
    </section>
  )
}

/** Project page: picture (live preview from M4), plain description, technical details folded. */
export function ProjectScreen({ projectId, onBack }: { projectId: string; onBack: () => void }): ReactNode {
  const { t, tx, lang } = useT()
  const { manifest } = useProjects()
  const project: Project | undefined = manifest?.state === 'ok' ? manifest.manifest.projects.find((p) => p.id === projectId) : undefined

  if (!project) return null
  const notFound = t('technical.notFound')

  return (
    <div className="flex max-w-5xl flex-col gap-8" data-testid="project-page">
      <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronBack />
        {tx('vocab.myProjects')}
      </button>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-4xl leading-tight text-ink">
          <bdi>{project.name}</bdi>
        </h1>
        <StatusPill status={project.status} />
      </header>

      <div className="overflow-hidden rounded-[12px] border border-border bg-card">
        <ProjectPicture project={project} className="h-56" />
        <p className="px-5 py-3 text-sm text-muted">{tx('project.previewSoon')}</p>
      </div>

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
        <LtrBlock label={t('technical.port')}>{project.run.port ?? notFound}</LtrBlock>
        {project.keys.length > 0 ? <LtrBlock label={t('technical.keys')}>{project.keys.map((k) => k.key).join('\n')}</LtrBlock> : null}
        {project.notes.length > 0 ? <LogBlock lines={project.notes} label={t('technical.notes')} /> : null}
      </TechnicalDetails>
    </div>
  )
}

