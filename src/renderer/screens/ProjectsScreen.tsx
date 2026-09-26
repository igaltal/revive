import { useEffect, useState, type ReactNode } from 'react'
import type { FolderProblem } from '@shared/folder'
import type { Manifest } from '@shared/manifest'
import type { ScanDone } from '@shared/scan'
import { useT } from '@/i18n/useT'
import { LtrBlock } from '@/i18n/bidi'
import { useSettings } from '@/state/settings'
import { useProjects } from '@/state/projects'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'
import { LogBlock } from '@/components/LogBlock'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { ProjectCard } from '@/components/ProjectCard'

function ScanResult({ result, onCheckComputer }: { result: ScanDone; onCheckComputer: () => void }): ReactNode {
  const { t, tx } = useT()
  const { startScan, dismissResult } = useProjects()
  const cost = result.costUsd !== null && result.costUsd > 0 ? <p className="text-sm text-muted">{tx('projects.cost', { cost: result.costUsd })}</p> : null

  if (result.ok) {
    return (
      <Notice tone="ok" testId="scan-result" actions={<Button variant="quiet" onClick={dismissResult}>{tx('common.continue')}</Button>}>
        <p>{tx('projects.found', { count: result.manifest.projects.length })}</p>
        {cost}
      </Notice>
    )
  }

  const e = result.error
  const needsComputer = e.code === 'claude_missing' || e.code === 'auth'
  return (
    <Notice
      tone={e.code === 'cancelled' ? 'attention' : 'broken'}
      testId="scan-result"
      actions={
        needsComputer ? (
          <Button onClick={onCheckComputer}>{tx(e.code === 'auth' ? 'prereq.signIn.button' : 'projects.checkComputer')}</Button>
        ) : (
          <Button onClick={startScan}>{tx('projects.readAgain')}</Button>
        )
      }
    >
      <p data-testid="scan-error" data-code={e.code}>
        {tx(`scanError.${e.code}`)}
      </p>
      {cost}
      {e.restored?.length || e.quarantined?.length || e.unrestorable?.length || e.detail?.length ? (
        <TechnicalDetails>
          {e.restored?.length ? <LtrBlock label={t('scanError.restored')}>{e.restored.join('\n')}</LtrBlock> : null}
          {e.quarantined?.length ? <LtrBlock label={t('scanError.quarantined')}>{['.revive/quarantine/', ...e.quarantined.map((q) => `  ${q}`)].join('\n')}</LtrBlock> : null}
          {e.unrestorable?.length ? <LtrBlock label={t('scanError.unrestorable')}>{e.unrestorable.join('\n')}</LtrBlock> : null}
          {e.detail?.length ? <LogBlock label={t(e.code === 'invalid_manifest' ? 'scanError.issues' : 'scanError.log')} lines={e.detail} /> : null}
        </TechnicalDetails>
      ) : null}
    </Notice>
  )
}

function Gallery({ manifest, folder, onOpenProject }: { manifest: Manifest; folder: string; onOpenProject: (id: string) => void }): ReactNode {
  const { t, tx } = useT()
  if (manifest.projects.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center text-muted">
        <p className="text-[15px]">{tx('projects.empty')}</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      {/* 4 columns from 1280px, 3 from 960px, 2 below. */}
      <div data-testid="gallery" className="grid grid-cols-2 gap-5 min-[960px]:grid-cols-3 min-[1280px]:grid-cols-4">
        {manifest.projects.map((p) => (
          // Starting and checking arrive with the runner (M4); for now both open the project page.
          <ProjectCard key={p.id} project={p} onOpen={() => onOpenProject(p.id)} onAction={() => onOpenProject(p.id)} />
        ))}
      </div>
      {manifest.loose_files.length > 0 ? (
        <p data-testid="loose-files" className="text-[15px] text-muted">
          {tx('projects.loose', { count: manifest.loose_files.length })}
        </p>
      ) : null}
      {/* One place for everything technical on this screen. */}
      <TechnicalDetails>
        <LtrBlock label={t('technical.folder')}>{folder}</LtrBlock>
        {manifest.loose_files.length > 0 ? <LtrBlock label={t('projects.looseList')}>{manifest.loose_files.join('\n')}</LtrBlock> : null}
      </TechnicalDetails>
    </div>
  )
}

export function ProjectsScreen({
  onChangeFolder,
  onOpenProject,
  onCheckComputer
}: {
  onChangeFolder: () => void
  onOpenProject: (id: string) => void
  onCheckComputer: () => void
}): ReactNode {
  const { t, tx } = useT()
  const { settings } = useSettings()
  const { manifest, lastResult, startScan } = useProjects()
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

  const hasList = manifest?.state === 'ok'
  const scannedAt = manifest?.state === 'ok' ? new Date(manifest.manifest.scanned_at) : null

  return (
    <div>
      <PageHeader
        title={tx('vocab.myProjects')}
        subtitle={
          name ? (
            <span className="flex flex-col gap-0.5">
              <span data-testid="current-folder">
                {t('folder.current')}: <bdi className="font-medium text-ink">{name}</bdi>
              </span>
              {scannedAt ? <span className="text-sm">{tx('projects.lastRead', { date: scannedAt })}</span> : null}
            </span>
          ) : (
            tx('projects.subtitle')
          )
        }
        actions={
          <>
            {hasList && !problem ? (
              <Button variant="secondary" data-testid="scan-again" onClick={startScan}>
                {tx('projects.readAgain')}
              </Button>
            ) : null}
            <Button variant="secondary" data-testid="change-folder" onClick={onChangeFolder}>
              {tx('folder.change')}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-6">
        {problem ? (
          <Notice tone="broken" testId="folder-problem" actions={<Button onClick={onChangeFolder}>{tx('folder.change')}</Button>}>
            <p>{tx(`folder.problem.${problem}`)}</p>
          </Notice>
        ) : (
          <>
            {lastResult ? <ScanResult result={lastResult} onCheckComputer={onCheckComputer} /> : null}

            {manifest?.state === 'none' && !lastResult ? (
              <Notice
                testId="not-read"
                title={tx('projects.notRead.title')}
                actions={
                  <Button data-testid="scan-start" onClick={startScan}>
                    {tx('projects.read')}
                  </Button>
                }
              >
                <p>{tx('projects.notRead.body')}</p>
              </Notice>
            ) : null}

            {manifest?.state === 'invalid' ? (
              <Notice tone="broken" testId="manifest-invalid" actions={<Button onClick={startScan}>{tx('projects.readAgain')}</Button>}>
                <p>{tx('projects.invalid')}</p>
                <TechnicalDetails>
                  <LogBlock lines={manifest.issues} />
                </TechnicalDetails>
              </Notice>
            ) : null}

            {manifest?.state === 'ok' && folder ? <Gallery manifest={manifest.manifest} folder={folder} onOpenProject={onOpenProject} /> : null}
          </>
        )}

        {folder && manifest?.state !== 'ok' ? (
          <TechnicalDetails>
            <LtrBlock label={t('technical.folder')}>{folder}</LtrBlock>
          </TechnicalDetails>
        ) : null}
      </div>
    </div>
  )
}
