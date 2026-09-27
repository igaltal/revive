import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CLAUDE_INSTALL_COMMAND, CLAUDE_SIGN_IN_COMMAND, isReady, type PrereqReport, type TaskUpdate } from '@shared/prereq'
import { useT } from '@/i18n/useT'
import { LtrBlock } from '@/i18n/bidi'
import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'
import { LogBlock } from '@/components/LogBlock'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { ArrowForward } from '@/components/icons'
import { cx } from '@/components/cx'
import { transport } from '@/transport'

type RowState = 'ready' | 'missing' | 'notSignedIn' | 'optional' | 'recommended'
type TaskState = { phase: TaskUpdate['phase'] | 'idle'; lines: string[] }

const rowTone: Record<RowState, string> = {
  ready: 'text-running',
  missing: 'text-broken',
  notSignedIn: 'text-broken',
  recommended: 'text-attention',
  optional: 'text-muted'
}
const rowDot: Record<RowState, string> = {
  ready: 'bg-running',
  missing: 'bg-broken',
  notSignedIn: 'bg-broken',
  recommended: 'bg-attention',
  optional: 'bg-border'
}

function Row({ id, state }: { id: string; state: RowState | 'checking' }): ReactNode {
  const { tx } = useT()
  return (
    <li data-testid={`prereq-${id}`} data-state={state} className="flex items-center justify-between gap-6 py-4">
      <div className="min-w-0">
        <div className="text-[15px] font-medium text-ink">{tx(`prereq.tool.${id}.name`)}</div>
        <div className="text-sm text-muted">{tx(`prereq.tool.${id}.purpose`)}</div>
      </div>
      {state === 'checking' ? (
        <span className="shrink-0 text-sm text-muted">{tx('common.checking')}</span>
      ) : (
        <span className={cx('inline-flex shrink-0 items-center gap-2 text-sm font-medium', rowTone[state])}>
          <span className={cx('size-2 rounded-full', rowDot[state])} aria-hidden />
          {tx(`prereq.status.${state}`)}
        </span>
      )}
    </li>
  )
}

export function PrereqStep({ onContinue }: { onContinue: () => void }): ReactNode {
  const { t, tx } = useT()
  const [report, setReport] = useState<PrereqReport | null>(null)
  const [checking, setChecking] = useState(true)
  const [confirmInstall, setConfirmInstall] = useState(false)
  const [install, setInstall] = useState<TaskState>({ phase: 'idle', lines: [] })
  const [signIn, setSignIn] = useState<TaskState>({ phase: 'idle', lines: [] })

  const check = useCallback(async () => {
    setChecking(true)
    try {
      setReport(await transport.invoke('prereq:check'))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    void transport.invoke('prereq:check').then((first) => {
      if (!alive) return
      setReport(first)
      setChecking(false)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(
    () =>
      transport.on('prereq:task', (u) => {
        const set = u.task === 'install-claude' ? setInstall : setSignIn
        set((prev) => ({ phase: u.phase, lines: u.line ? [...prev.lines, u.line].slice(-400) : prev.lines }))
        // Re-check automatically once an install or sign-in ends.
        if (u.phase !== 'running') void check()
      }),
    [check]
  )

  const help = (topic: 'claude-install' | 'git' | 'node') => void transport.invoke('shell:openHelp', { topic })
  const r = report
  const busy = checking && !r

  const claudeState: RowState = r?.claude.installed ? 'ready' : 'missing'
  const signInState: RowState = r?.claude.signedIn === 'yes' ? 'ready' : 'notSignedIn'
  const gitState: RowState = r?.git.installed ? 'ready' : 'missing'
  const nodeState: RowState = r?.node.installed ? 'ready' : 'recommended'
  const codexState: RowState = r?.codex.installed ? 'ready' : 'optional'
  const ready = r ? isReady(r) : false

  const startInstall = () => {
    setConfirmInstall(false)
    setInstall({ phase: 'running', lines: [] })
    void transport.invoke('prereq:installClaude')
  }
  const startSignIn = () => {
    setSignIn({ phase: 'running', lines: [] })
    void transport.invoke('prereq:signIn')
  }

  let panel: ReactNode = null
  if (r && !r.claude.installed) {
    if (install.phase === 'running') {
      panel = (
        <Notice testId="panel-installing" title={tx('prereq.install.title')}>
          <p>{tx('prereq.install.running')}</p>
          <LogBlock label={t('prereq.output')} lines={install.lines} />
        </Notice>
      )
    } else if (confirmInstall) {
      panel = (
        <Notice
          testId="panel-install-confirm"
          tone="attention"
          title={tx('prereq.install.confirmTitle')}
          actions={
            <>
              <Button data-testid="install-confirm" onClick={startInstall}>
                {tx('prereq.install.confirmButton')}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmInstall(false)}>
                {tx('common.notNow')}
              </Button>
            </>
          }
        >
          <p>{tx('prereq.install.confirmBody')}</p>
          <TechnicalDetails>
            <LtrBlock label={t('technical.command')}>{CLAUDE_INSTALL_COMMAND}</LtrBlock>
          </TechnicalDetails>
        </Notice>
      )
    } else {
      panel = (
        <Notice
          testId="panel-install"
          tone={install.phase === 'failed' ? 'broken' : 'neutral'}
          title={tx('prereq.install.title')}
          actions={
            <>
              <Button data-testid="install-start" onClick={() => setConfirmInstall(true)}>
                {tx(install.phase === 'failed' ? 'common.tryAgain' : 'prereq.install.button')}
              </Button>
              <Button variant="secondary" onClick={() => help('claude-install')}>
                {tx('common.openOfficialPage')}
              </Button>
            </>
          }
        >
          <p>{tx(install.phase === 'failed' ? 'prereq.install.failed' : 'prereq.install.body')}</p>
          <TechnicalDetails>
            <LtrBlock label={t('technical.command')}>{CLAUDE_INSTALL_COMMAND}</LtrBlock>
            {install.lines.length > 0 ? <LogBlock label={t('prereq.output')} lines={install.lines} /> : null}
          </TechnicalDetails>
        </Notice>
      )
    }
  } else if (r && r.claude.signedIn !== 'yes') {
    const failed = signIn.phase === 'failed'
    panel = (
      <Notice
        testId="panel-sign-in"
        tone={failed ? 'broken' : 'neutral'}
        title={tx('prereq.signIn.title')}
        actions={
          signIn.phase === 'running' ? null : (
            <>
              <Button data-testid="sign-in-start" onClick={startSignIn}>
                {tx(failed ? 'common.tryAgain' : 'prereq.signIn.button')}
              </Button>
              <Button variant="secondary" onClick={() => void check()}>
                {tx('common.checkAgain')}
              </Button>
            </>
          )
        }
      >
        <p>{tx(signIn.phase === 'running' ? 'prereq.signIn.waiting' : failed ? 'prereq.signIn.failed' : 'prereq.signIn.body')}</p>
        {failed ? <LtrBlock>claude</LtrBlock> : null}
        <TechnicalDetails>
          <LtrBlock label={t('technical.command')}>{CLAUDE_SIGN_IN_COMMAND}</LtrBlock>
          {signIn.lines.length > 0 ? <LogBlock label={t('prereq.output')} lines={signIn.lines} /> : null}
        </TechnicalDetails>
      </Notice>
    )
  } else if (r && !r.git.installed) {
    panel = (
      <Notice
        testId="panel-git"
        tone="broken"
        title={tx('prereq.git.title')}
        actions={
          <>
            <Button onClick={() => void check()}>{tx('common.checkAgain')}</Button>
            <Button variant="secondary" onClick={() => help('git')}>
              {tx('common.openOfficialPage')}
            </Button>
          </>
        }
      >
        <p>{tx('prereq.git.body')}</p>
      </Notice>
    )
  }

  return (
    <>
      <div>
        <h1 className="text-4xl leading-tight text-ink">{tx('prereq.title')}</h1>
        <p className="mt-2 text-[15px] text-muted">{tx('prereq.subtitle')}</p>
      </div>

      <ul className="divide-y divide-border rounded-[12px] border border-border bg-card px-5">
        <Row id="claude" state={busy ? 'checking' : claudeState} />
        {!r || r.claude.installed ? <Row id="signIn" state={busy ? 'checking' : signInState} /> : null}
        <Row id="git" state={busy ? 'checking' : gitState} />
        <Row id="node" state={busy ? 'checking' : nodeState} />
        <Row id="codex" state={busy ? 'checking' : codexState} />
      </ul>

      {panel}

      {r && ready && !r.node.installed ? (
        <Notice
          testId="panel-node"
          tone="attention"
          actions={
            <Button variant="secondary" onClick={() => help('node')}>
              {tx('common.openOfficialPage')}
            </Button>
          }
        >
          <p>{tx('prereq.node.note')}</p>
        </Notice>
      ) : null}

      {r ? (
        <TechnicalDetails>
          <LtrBlock label={t('prereq.versions')}>
            {[
              `claude ${r.claude.version ?? '-'}`,
              `git    ${r.git.version ?? '-'}`,
              `node   ${r.node.version ?? '-'}`,
              `codex  ${r.codex.version ?? '-'}`
            ].join('\n')}
          </LtrBlock>
        </TechnicalDetails>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-running">{ready ? tx('prereq.allReady') : null}</span>
        <Button data-testid="prereq-continue" disabled={!ready} onClick={onContinue}>
          {tx('common.continue')}
          <ArrowForward />
        </Button>
      </div>
    </>
  )
}
