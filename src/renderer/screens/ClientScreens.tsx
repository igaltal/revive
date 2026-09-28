import type { ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { transport } from '@/transport'
import { useClient } from '@/state/client'
import { FullScreen } from '@/components/FullScreen'
import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'

/** Client mode, while the Host can't be reached (asleep, restarting, off the network). */
export function ClientConnecting(): ReactNode {
  const { tx } = useT()
  const client = useClient()
  return (
    <FullScreen>
      <div className="flex flex-col gap-6" data-testid="client-connecting">
        <h1 className="text-4xl leading-tight text-ink">{tx('client.connecting.title', { host: client.host?.name ?? '' })}</h1>
        <p className="text-[15px] text-ink/80">{tx('client.connecting.body')}</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
          <div className="h-full w-1/3 animate-pulse rounded-full bg-attention" />
        </div>
        <div>
          <Button variant="secondary" onClick={() => void transport.invoke('client:disconnect')}>
            {tx('client.workHere')}
          </Button>
        </div>
      </div>
    </FullScreen>
  )
}

/** Client mode, after the Host revoked this computer. */
export function ClientRejected(): ReactNode {
  const { tx } = useT()
  const client = useClient()
  return (
    <FullScreen>
      <div className="flex flex-col gap-6" data-testid="client-rejected">
        <h1 className="text-4xl leading-tight text-ink">{tx('client.rejected.title', { host: client.host?.name ?? '' })}</h1>
        <Notice tone="broken" actions={<Button data-testid="client-forget" onClick={() => void transport.invoke('client:disconnect')}>{tx('client.workHere')}</Button>}>
          <p>{tx(client.problem === 'no_keychain' ? 'client.problem.no_keychain' : 'client.rejected.body')}</p>
        </Notice>
      </div>
    </FullScreen>
  )
}
