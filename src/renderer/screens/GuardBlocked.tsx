import type { ReactNode } from 'react'
import type { GuardState } from '@shared/guard'
import { useT } from '@/i18n/useT'
import { LogBlock } from '@/components/LogBlock'
import { FullScreen } from '@/components/FullScreen'
import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { transport } from '@/transport'

/**
 * Shown at startup, over everything, when the installed Claude Code ignored
 * the turn limit in Revive's check. Revive won't let it read any folder.
 */
export function GuardBlocked({ guard, onRecheck }: { guard: Extract<GuardState, { state: 'failed' }>; onRecheck: () => void }): ReactNode {
  const { t, tx } = useT()
  return (
    <FullScreen>
      <div data-testid="guard-blocked" className="flex flex-col gap-6">
        <h1 className="text-4xl leading-tight text-ink">{tx('guard.title')}</h1>
        <Notice
          tone="broken"
          actions={
            <>
              {transport.capabilities().openHelp ? (
                <Button onClick={() => void transport.invoke('shell:openHelp', { topic: 'claude-install' })}>{tx('guard.update')}</Button>
              ) : null}
              <Button variant="secondary" onClick={onRecheck}>
                {tx('common.checkAgain')}
              </Button>
            </>
          }
        >
          <p>{tx('guard.body', { version: guard.version ?? '' })}</p>
        </Notice>
        <TechnicalDetails>
          <LogBlock label={t('guard.detail')} lines={[`claude --version  ${guard.version ?? '?'}`, 'check             --max-turns 1', ...guard.detail]} />
        </TechnicalDetails>
      </div>
    </FullScreen>
  )
}
