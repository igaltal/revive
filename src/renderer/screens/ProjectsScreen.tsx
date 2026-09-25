import { useEffect, useState, type ReactNode } from 'react'
import type { FolderProblem } from '@shared/folder'
import { useT } from '@/i18n/useT'
import { LtrBlock } from '@/i18n/bidi'
import { useSettings } from '@/state/settings'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'
import { TechnicalDetails } from '@/components/TechnicalDetails'

export function ProjectsScreen({ onChangeFolder }: { onChangeFolder: () => void }): ReactNode {
  const { t, tx } = useT()
  const { settings } = useSettings()
  const folder = settings.lastFolder
  const [problem, setProblem] = useState<FolderProblem | null>(null)
  const [name, setName] = useState<string | null>(null)

  useEffect(() => {
    if (!folder) return
    let alive = true
    void window.revive.invoke('folder:check', { path: folder }).then((check) => {
      if (!alive) return
      setProblem(check.ok ? null : check.problem)
      setName(check.ok ? check.name : null)
    })
    return () => {
      alive = false
    }
  }, [folder])

  return (
    <div>
      <PageHeader
        title={tx('vocab.myProjects')}
        subtitle={
          name ? (
            <span data-testid="current-folder">
              {t('folder.current')}: <bdi className="font-medium text-ink">{name}</bdi>
            </span>
          ) : (
            tx('projects.subtitle')
          )
        }
        actions={
          <Button variant="secondary" data-testid="change-folder" onClick={onChangeFolder}>
            {tx('folder.change')}
          </Button>
        }
      />
      <div className="flex flex-col gap-6">
        {problem ? (
          <Notice
            tone="broken"
            testId="folder-problem"
            actions={<Button onClick={onChangeFolder}>{tx('folder.change')}</Button>}
          >
            <p>{tx(`folder.problem.${problem}`)}</p>
          </Notice>
        ) : (
          <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center text-muted">
            <p className="max-w-sm text-[15px]">{tx('projects.placeholderFolder')}</p>
          </div>
        )}
        {folder ? (
          <TechnicalDetails>
            <LtrBlock label={t('technical.folder')}>{folder}</LtrBlock>
          </TechnicalDetails>
        ) : null}
      </div>
    </div>
  )
}
