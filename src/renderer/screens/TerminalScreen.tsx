import { useEffect, useState, type ReactNode } from 'react'
import type { SessionsInfo } from '@shared/contract'
import { parseSessionId, type SessionKind } from '@shared/runtime'
import { useT } from '@/i18n/useT'
import { LtrBlock } from '@/i18n/bidi'
import { transport } from '@/transport'
import { useProjects } from '@/state/projects'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Notice } from '@/components/Notice'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { TerminalView } from '@/components/TerminalView'
import { ChevronBack } from '@/components/icons'
import { cx } from '@/components/cx'

interface OpenSession {
  sessionId: string
  kind: SessionKind
}

/** Which sessions this project has open right now, kept current from the event stream. */
function useProjectSessions(projectId: string): OpenSession[] {
  const [sessions, setSessions] = useState<OpenSession[]>([])
  useEffect(() => {
    let alive = true
    const refresh = () =>
      void transport
        .invoke('sessions:list')
        .then((list) => alive && setSessions(list.filter((s) => s.projectId === projectId).map((s) => ({ sessionId: s.sessionId, kind: s.kind }))))
        .catch(() => {})
    refresh()
    const off = transport.subscribe('runtime:event', (e) => {
      if ((e.type === 'process.started' || e.type === 'process.exited') && e.session.projectId === projectId) refresh()
    })
    return () => {
      alive = false
      off()
    }
  }, [projectId])
  return sessions
}

export function useSessionsInfo(): SessionsInfo | null {
  const [info, setInfo] = useState<SessionsInfo | null>(null)
  useEffect(() => {
    let alive = true
    void transport
      .invoke('sessions:info')
      .then((i) => alive && setInfo(i))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return info
}

/** Terminals of one project: a tab per open session. The same locally and on a Host. */
export function TerminalScreen({ projectId, sessionId, onBack }: { projectId: string; sessionId: string; onBack: () => void }): ReactNode {
  const { t, tx } = useT()
  const { manifest } = useProjects()
  const sessions = useProjectSessions(projectId)
  const info = useSessionsInfo()
  const [active, setActive] = useState(sessionId)
  const [ending, setEnding] = useState<OpenSession | null>(null)
  const project = manifest?.state === 'ok' ? manifest.manifest.projects.find((p) => p.id === projectId) : undefined
  const tabs: OpenSession[] = sessions.some((s) => s.sessionId === active) || !parseSessionId(active) ? sessions : [...sessions, { sessionId: active, kind: parseSessionId(active)!.kind }]
  const current = tabs.find((s) => s.sessionId === active) ?? tabs[0] ?? null

  return (
    <div className="flex h-full flex-col gap-4 max-[639px]:h-auto" data-testid="terminal-screen">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-ink" data-testid="terminal-back">
          <ChevronBack />
          <bdi>{project?.name ?? projectId}</bdi>
        </button>
        {current && current.kind !== 'run' ? (
          <Button variant="secondary" data-testid="terminal-end" onClick={() => setEnding(current)}>
            {tx('terminal.end')}
          </Button>
        ) : null}
      </div>

      {info && !info.persistent ? (
        <Notice tone="attention" testId="terminal-banner">
          <p className="flex flex-wrap items-center gap-2">
            {tx('terminal.banner')} <code dir="ltr" className="rounded bg-bg px-1.5 py-0.5 font-mono text-[13px]">brew install tmux</code>
          </p>
        </Notice>
      ) : null}

      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border" dir="auto">
        {tabs.map((s) => (
          <button
            key={s.sessionId}
            type="button"
            role="tab"
            aria-selected={s.sessionId === current?.sessionId}
            data-testid="terminal-tab"
            data-session={s.sessionId}
            onClick={() => setActive(s.sessionId)}
            className={cx('min-h-[40px] rounded-t-[8px] px-4 text-sm font-medium', s.sessionId === current?.sessionId ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink')}
          >
            {tx(`terminal.kind.${s.kind}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 max-[639px]:flex-none">{current ? <TerminalView key={current.sessionId} sessionId={current.sessionId} /> : <p className="text-muted">{tx('terminal.empty')}</p>}</div>

      <TechnicalDetails>
        {current ? <LtrBlock label={t('terminal.session')}>{current.sessionId}</LtrBlock> : null}
        <p className="text-sm text-muted" data-testid="terminal-hebrew-note">
          {tx('terminal.hebrewNote')}
        </p>
      </TechnicalDetails>

      <Dialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        testId="terminal-end-confirm"
        title={tx('terminal.endConfirm.title')}
        actions={
          <>
            <Button variant="quiet" onClick={() => setEnding(null)}>
              {tx('common.cancel')}
            </Button>
            <Button
              data-testid="terminal-end-confirm-button"
              className="bg-broken hover:bg-broken/90"
              onClick={() => {
                if (ending) void transport.invoke('sessions:close', { sessionId: ending.sessionId, confirm: true })
                setEnding(null)
                onBack()
              }}
            >
              {tx('terminal.endConfirm.button')}
            </Button>
          </>
        }
      >
        <p>{ending ? tx('terminal.endConfirm.body', { kind: t(`terminal.kind.${ending.kind}`) }) : null}</p>
      </Dialog>
    </div>
  )
}
