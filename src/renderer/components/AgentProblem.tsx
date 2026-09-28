import type { ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { LtrBlock } from '@/i18n/bidi'
import { transport } from '@/transport'
import { useHostName } from '@/state/client'
import { Button } from './Button'
import { Notice } from './Notice'

export interface AgentProblemInfo {
  kind: 'claude' | 'codex'
  problem: 'not_installed' | 'signed_out'
}

/**
 * Why Claude Code or Codex didn't open, in one sentence, and the one step
 * that fixes it. On another computer's window, the step happens there.
 */
export function AgentProblem({ info, onDismiss }: { info: AgentProblemInfo; onDismiss: () => void }): ReactNode {
  const { tx } = useT()
  const hostName = useHostName()
  const caps = transport.capabilities()
  const where = hostName ? tx('agent.onHost', { host: hostName }) : null
  const action =
    info.kind === 'claude' && info.problem === 'signed_out' && caps.installTools ? (
      <Button data-testid="agent-fix" onClick={() => void transport.invoke('prereq:signIn')}>
        {tx('prereq.signIn.button')}
      </Button>
    ) : info.problem === 'not_installed' && caps.openHelp ? (
      <Button data-testid="agent-fix" onClick={() => void transport.invoke('shell:openHelp', { topic: info.kind === 'claude' ? 'claude-install' : 'codex' })}>
        {tx('common.openOfficialPage')}
      </Button>
    ) : null

  return (
    <Notice
      tone="attention"
      testId="agent-problem"
      actions={
        <>
          {action}
          <Button variant="quiet" onClick={onDismiss}>
            {tx('common.close')}
          </Button>
        </>
      }
    >
      <p data-kind={info.kind} data-problem={info.problem}>
        {tx(`agent.${info.kind}.${info.problem}`)}
      </p>
      {info.kind === 'codex' && info.problem === 'signed_out' ? <LtrBlock>codex login</LtrBlock> : null}
      {where ? <p className="text-sm text-muted">{where}</p> : null}
    </Notice>
  )
}
