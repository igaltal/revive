import type { ReactNode } from 'react'
import type { Project } from '@shared/manifest'
import { useT } from '@/i18n/useT'
import { BidiText } from '@/i18n/bidi'
import type { DisplayStatus } from '@/state/runtime'
import { StatusPill } from './StatusPill'
import { Button } from './Button'
import { cx } from './cx'

/** The one action that matches the status. */
export function actionKeyFor(status: DisplayStatus['kind']): string {
  if (status === 'running' || status === 'busy') return 'vocab.open'
  if (status === 'verified') return 'vocab.start'
  return 'vocab.checkIfItWorks'
}

export function localized(text: { en: string; he: string }, lang: string): string {
  const primary = lang === 'he' ? text.he : text.en
  return primary.trim() || (lang === 'he' ? text.en : text.he)
}

/** The picture from the last successful start; a neutral placeholder before that. */
export function ProjectPicture({ project, src, className = 'aspect-[16/10]' }: { project: Project; src?: string | null; className?: string }): ReactNode {
  if (src) return <img src={src} alt="" data-testid="project-picture" className={cx(className, 'w-full border-b border-border bg-picture object-cover object-top')} />
  return (
    <div className={cx(className, 'flex w-full items-center justify-center border-b border-border bg-bg')} aria-hidden>
      <span className="font-display text-5xl text-muted/60">
        <bdi>{project.name.trim().charAt(0).toUpperCase()}</bdi>
      </span>
    </div>
  )
}

export function ProjectCard({
  project,
  status,
  picture,
  onOpen,
  onAction,
  explanation
}: {
  project: Project
  status: DisplayStatus
  picture?: string | null
  onOpen: () => void
  onAction: () => void
  explanation?: ReactNode
}): ReactNode {
  const { tx, lang } = useT()
  const description = localized(project.description, lang)
  return (
    <article data-testid="project-card" data-project={project.id} className="flex flex-col overflow-hidden rounded-[12px] border border-border bg-card shadow-sm">
      <button type="button" onClick={onOpen} className="text-start" aria-label={project.name}>
        <ProjectPicture project={project} src={picture} />
      </button>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-sans text-[17px] leading-snug font-semibold text-ink">
            <button type="button" onClick={onOpen} className="text-start hover:underline">
              <bdi>{project.name}</bdi>
            </button>
          </h2>
          <p className="text-sm leading-relaxed text-muted" data-testid="project-description">
            {description ? <BidiText text={description} lang={lang} /> : tx('card.noDescription')}
          </p>
        </div>
        {explanation ? <p className="text-sm leading-relaxed text-broken">{explanation}</p> : null}
        <div className="mt-auto flex flex-col items-start gap-3 pt-1">
          <StatusPill status={status} />
          <Button variant={status.kind === 'running' ? 'primary' : 'secondary'} className="w-full" data-testid="card-action" onClick={onAction}>
            {tx(actionKeyFor(status.kind))}
          </Button>
        </div>
      </div>
    </article>
  )
}
