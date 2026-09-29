import type { ReactNode } from 'react'
import type { Project } from '@shared/manifest'
import { useT } from '@/i18n/useT'
import { BidiText } from '@/i18n/bidi'
import type { DisplayStatus } from '@/state/runtime'
import { StatusPill } from './StatusPill'
import { Button } from './Button'
import { cx } from './cx'
import { TileIcon } from './TileIcon'
import { tileLook } from '@/theme/tiles'
import { useAppearanceMaybe } from '@/state/appearance'

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

/**
 * The picture from the last successful start. Before that, the project's own
 * icon on a soft tint of its color (the same as on Home), in a short strip,
 * instead of a tall empty box.
 */
export function ProjectPicture({ project, src, className = 'aspect-[16/10]', emptyClassName = 'h-24' }: { project: Project; src?: string | null; className?: string; emptyClassName?: string }): ReactNode {
  const look = useAppearanceMaybe()?.look
  if (src) return <img src={src} alt="" data-testid="project-picture" className={cx(className, 'w-full border-b border-border bg-picture object-cover object-top')} />
  const tile = tileLook(project.id, look?.tiles[project.id])
  return (
    <div
      className={cx(emptyClassName, 'flex w-full items-center justify-center border-b border-border')}
      style={{ background: `linear-gradient(160deg, color-mix(in oklab, ${tile.from} 22%, var(--color-card)), color-mix(in oklab, ${tile.to} 12%, var(--color-card)))` }}
      data-testid="project-placeholder"
      aria-hidden
    >
      <TileIcon projectId={project.id} size={52} />
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
      {/* On a phone the list stays compact: the icon sits next to the name instead of a picture on top. */}
      <button type="button" onClick={onOpen} className="text-start max-[639px]:hidden" aria-label={project.name}>
        <ProjectPicture project={project} src={picture} />
      </button>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <button type="button" onClick={onOpen} className="shrink-0 min-[640px]:hidden" aria-label={project.name}>
            <TileIcon projectId={project.id} size={40} />
          </button>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-sans text-[17px] leading-snug font-semibold text-ink">
              <button type="button" onClick={onOpen} className="text-start hover:underline">
                <bdi>{project.name}</bdi>
              </button>
            </h2>
            <p className="text-sm leading-relaxed text-muted max-[639px]:line-clamp-2" data-testid="project-description">
              {description ? <BidiText text={description} lang={lang} /> : tx('card.noDescription')}
            </p>
          </div>
        </div>
        {explanation ? <p className="text-sm leading-relaxed text-broken">{explanation}</p> : null}
        <div className="mt-auto flex flex-col items-start gap-3 pt-1 max-[639px]:flex-row max-[639px]:items-center max-[639px]:justify-between">
          <StatusPill status={status} />
          <Button variant={status.kind === 'running' ? 'primary' : 'secondary'} className="w-full max-[639px]:w-auto" data-testid="card-action" onClick={onAction}>
            {tx(actionKeyFor(status.kind))}
          </Button>
        </div>
      </div>
    </article>
  )
}
