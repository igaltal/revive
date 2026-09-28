import { useEffect, useState, type ReactNode } from 'react'
import type { ActivityEntry, HostStatus, PairingCode } from '@shared/host'
import { useT } from '@/i18n/useT'
import { LtrBlock } from '@/i18n/bidi'
import { transport } from '@/transport'
import { useClient } from '@/state/client'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Notice } from './Notice'
import { TechnicalDetails } from './TechnicalDetails'
import { cx } from './cx'

export function Switch({ checked, onChange, label, testId, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: ReactNode; testId?: string; disabled?: boolean }): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-[42px] items-center gap-3 text-start text-[15px] text-ink disabled:opacity-50"
    >
      <span className={cx('relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-running' : 'bg-border')}>
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-knob shadow transition-[inset-inline-start]', checked ? 'start-[22px]' : 'start-0.5')} />
      </span>
      {label}
    </button>
  )
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

/** The six digits and the QR code of the pairing link, with the time left. */
export function PairingDialog({ open, onClose, hostCode }: { open: boolean; onClose: () => void; hostCode: string | null }): ReactNode {
  const { tx } = useT()
  const [code, setCode] = useState<PairingCode | null>(null)
  const [problem, setProblem] = useState(false)
  const now = useNow(1000)

  useEffect(() => {
    if (!open) return
    let alive = true
    void transport.invoke('host:startPairing').then(
      (c) => alive && setCode(c),
      () => alive && setProblem(true)
    )
    return () => {
      alive = false
      void transport.invoke('host:cancelPairing').catch(() => {})
    }
  }, [open])

  const left = code ? Math.max(0, Math.round((Date.parse(code.expiresAt) - now) / 1000)) : 0
  const close = () => {
    setCode(null)
    setProblem(false)
    onClose()
  }
  // Once a device has sent the code it's used up, so the dialog goes; "Allow?" comes next.
  // Used = the Host showed this code, and doesn't any more (not merely "hasn't caught up yet").
  const [seen, setSeen] = useState<string | null>(null)
  if (code && hostCode === code.code && seen !== code.code) setSeen(code.code)
  const used = code !== null && seen === code.code && hostCode !== code.code && left > 0
  const visible = open && !used
  return (
    <Dialog
      open={visible}
      onClose={close}
      testId="pairing-dialog"
      title={tx('host.pair.title')}
      actions={
        <>
          {code && left === 0 ? (
            <Button variant="secondary" onClick={() => void transport.invoke('host:startPairing').then(setCode)}>
              {tx('host.pair.newCode')}
            </Button>
          ) : null}
          <Button variant="quiet" onClick={close}>
            {tx('common.close')}
          </Button>
        </>
      }
    >
      <p>{tx('host.pair.body')}</p>
      {problem ? <p className="text-broken">{tx('host.pair.needsSharing')}</p> : null}
      {code ? (
        <div className="flex flex-wrap items-center gap-6">
          {/* The SVG comes from main's QR generator for our own link: a data URL, never inline markup. */}
          <img alt={tx('host.pair.qrAlt') as string} className="size-40 rounded-md border border-border bg-picture p-1" src={`data:image/svg+xml;utf8,${encodeURIComponent(code.qrSvg)}`} data-testid="pairing-qr" />
          <div className="flex flex-col gap-2">
            <span dir="ltr" className="font-mono text-4xl tracking-[0.3em] text-ink" data-testid="pairing-code">
              {code.code}
            </span>
            <span className="text-sm text-muted">{left > 0 ? tx('host.pair.expires', { seconds: left }) : tx('host.pair.expired')}</span>
          </div>
        </div>
      ) : null}
      {code ? (
        <TechnicalDetails>
          <LtrBlock label={tx('host.pair.link') as string}>{code.link}</LtrBlock>
        </TechnicalDetails>
      ) : null}
    </Dialog>
  )
}

/** Shown over everything on the Host when a device asks to connect. Nothing is issued until Allow. */
export function PairingRequests({ host }: { host: HostStatus | null }): ReactNode {
  const { tx } = useT()
  const request = host?.requests[0] ?? null
  const answer = (allow: boolean) => request && void transport.invoke('host:answerPairing', { requestId: request.id, allow })
  return (
    <Dialog
      open={request !== null}
      onClose={() => answer(false)}
      testId="pairing-request"
      title={request ? tx('host.request.title', { name: request.deviceName }) : null}
      actions={
        <>
          <Button variant="quiet" data-testid="pairing-deny" onClick={() => answer(false)}>
            {tx('host.request.deny')}
          </Button>
          <Button data-testid="pairing-allow" onClick={() => answer(true)}>
            {tx('host.request.allow')}
          </Button>
        </>
      }
    >
      <p>{tx('host.request.body')}</p>
    </Dialog>
  )
}

function Devices({ host }: { host: HostStatus }): ReactNode {
  const { tx } = useT()
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null)
  if (host.devices.length === 0) return <p className="text-[15px] text-muted">{tx('host.devices.none')}</p>
  return (
    <>
      <ul className="divide-y divide-border rounded-[12px] border border-border bg-card px-5" data-testid="devices">
        {host.devices.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="device-row">
            <div className="flex flex-col">
              <span className="font-medium text-ink">
                <bdi>{d.name}</bdi>
              </span>
              <span className="text-sm text-muted">
                {d.online ? tx('host.devices.online') : d.lastSeenAt ? tx('host.devices.lastSeen', { date: new Date(d.lastSeenAt) }) : tx('host.devices.never')}
              </span>
            </div>
            <Button variant="secondary" data-testid="device-revoke" onClick={() => setRevoking({ id: d.id, name: d.name })}>
              {tx('host.devices.revoke')}
            </Button>
          </li>
        ))}
      </ul>
      <Dialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        testId="revoke-confirm"
        title={revoking ? tx('host.devices.confirmTitle', { name: revoking.name }) : null}
        actions={
          <>
            <Button variant="quiet" onClick={() => setRevoking(null)}>
              {tx('common.cancel')}
            </Button>
            <Button
              data-testid="device-revoke-confirm"
              variant="danger"
              onClick={() => {
                if (revoking) void transport.invoke('host:revokeDevice', { deviceId: revoking.id })
                setRevoking(null)
              }}
            >
              {tx('host.devices.revoke')}
            </Button>
          </>
        }
      >
        <p>{tx('host.devices.confirmBody')}</p>
      </Dialog>
    </>
  )
}

function Activity({ host }: { host: HostStatus }): ReactNode {
  const { t, tx } = useT()
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  useEffect(() => {
    void transport.invoke('host:activity', { limit: 20 }).then(setEntries).catch(() => {})
  }, [host])
  if (entries.length === 0) return <p className="text-[15px] text-muted">{tx('host.activity.none')}</p>
  return (
    <ol className="divide-y divide-border rounded-[12px] border border-border bg-card px-5" data-testid="activity">
      {entries.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-3 py-2.5 text-[15px]" data-testid="activity-row">
          <span className="text-ink">
            <bdi className="font-medium">{e.deviceId === 'local' ? t('host.activity.thisComputer') : e.deviceName}</bdi>
            {' · '}
            {t(`host.activity.method.${e.method.replace(':', '_')}`, { defaultValue: e.method })}
            {typeof e.summary['projectId'] === 'string' ? (
              <>
                {' · '}
                <bdi>{e.summary['projectId']}</bdi>
              </>
            ) : null}
          </span>
          <span className="text-sm text-muted">{tx('history.when', { date: new Date(e.at) })}</span>
        </li>
      ))}
    </ol>
  )
}

/** Host mode, on the Host: the switch, how to reach it, pairing, devices and activity. */
export function SharingSection({ host }: { host: HostStatus }): ReactNode {
  const { t, tx } = useT()
  const [pairing, setPairing] = useState(false)
  // Each "Pair a device" starts a fresh dialog (and a fresh code).
  const [pairRun, setPairRun] = useState(0)
  const [confirmServe, setConfirmServe] = useState(false)
  const port = host.port ?? 0
  const serveCommand = `tailscale serve --bg ${port}`

  return (
    <div className="flex flex-col gap-5" data-testid="sharing">
      <Switch checked={host.sharing} testId="sharing-switch" disabled={!host.tmux && !host.sharing} onChange={(on) => void transport.invoke('host:setSharing', { on })} label={tx('host.share.switch')} />
      {!host.tmux ? (
        <Notice tone="attention" testId="sharing-needs-tmux">
          <p className="flex flex-wrap items-center gap-2">
            {tx('host.share.needsTmux')} <code dir="ltr" className="rounded bg-bg px-1.5 py-0.5 font-mono text-[13px]">brew install tmux</code>
          </p>
        </Notice>
      ) : null}

      {host.sharing ? (
        <>
          {host.sleepMinutes !== null && host.sleepMinutes > 0 ? (
            <Notice tone="attention" testId="sleep-warning">
              <p>{tx('host.share.sleep', { minutes: host.sleepMinutes })}</p>
            </Notice>
          ) : null}

          <section className="flex flex-col gap-2">
            <h3 className="font-medium text-ink">{tx('host.reach.title')}</h3>
            {host.tailscale.state === 'serving' && host.tailscale.address ? (
              <>
                <p className="text-[15px]">{tx('host.reach.serving')}</p>
                <LtrBlock>{host.tailscale.address}</LtrBlock>
              </>
            ) : host.tailscale.state === 'available' ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[15px]">{tx('host.reach.available')}</p>
                <Button variant="secondary" data-testid="tailscale-serve" onClick={() => setConfirmServe(true)}>
                  {tx('host.reach.button')}
                </Button>
              </div>
            ) : host.tailscale.state === 'missing' ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[15px]" data-testid="tailscale-missing">
                  {tx('host.reach.missing')}
                </p>
                {transport.capabilities().openHelp ? (
                  <Button variant="secondary" onClick={() => void transport.invoke('shell:openHelp', { topic: 'tailscale' })}>
                    {tx('host.reach.install')}
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-[15px] text-broken">{tx('host.reach.error')}</p>
            )}
            <TechnicalDetails>
              <LtrBlock label={t('host.reach.local')}>{`http://127.0.0.1:${port}`}</LtrBlock>
              {host.tailscale.detail ? <LtrBlock label={t('host.reach.detail')}>{host.tailscale.detail}</LtrBlock> : null}
            </TechnicalDetails>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-medium text-ink">{tx('host.devices.title')}</h3>
              <Button
                data-testid="pair-start"
                onClick={() => {
                  setPairRun((n) => n + 1)
                  setPairing(true)
                }}
                disabled={host.lockedUntil !== null}
              >
                {tx('host.pair.button')}
              </Button>
            </div>
            {host.lockedUntil ? <p className="text-sm text-broken">{tx('host.pair.locked', { date: new Date(host.lockedUntil) })}</p> : null}
            <Devices host={host} />
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="font-medium text-ink">{tx('host.activity.title')}</h3>
            <Activity host={host} />
          </section>
        </>
      ) : null}

      <Switch checked={host.startAtLogin} testId="login-switch" onChange={(on) => void transport.invoke('host:setStartAtLogin', { on })} label={tx('host.share.login')} />

      <PairingDialog key={pairRun} open={pairing} onClose={() => setPairing(false)} hostCode={host.pairing?.code ?? null} />
      <Dialog
        open={confirmServe}
        onClose={() => setConfirmServe(false)}
        testId="tailscale-confirm"
        title={tx('host.reach.confirmTitle')}
        actions={
          <>
            <Button variant="quiet" onClick={() => setConfirmServe(false)}>
              {tx('common.cancel')}
            </Button>
            <Button
              data-testid="tailscale-serve-confirm"
              onClick={() => {
                setConfirmServe(false)
                void transport.invoke('host:exposeTailscale', { confirm: true })
              }}
            >
              {tx('host.reach.confirmButton')}
            </Button>
          </>
        }
      >
        <p>{tx('host.reach.confirmBody')}</p>
        <LtrBlock>{serveCommand}</LtrBlock>
      </Dialog>
    </div>
  )
}

/** "Connect to another computer": the Host's address and the code on its screen. */
export function ConnectForm({ testId = 'connect-form' }: { testId?: string }): ReactNode {
  const { t, tx } = useT()
  const client = useClient()
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState(() => t('client.defaultName'))
  const waiting = client.state === 'pairing' || client.state === 'waiting'
  const valid = address.trim().length > 0 && /^\d{6}$/.test(code) && name.trim().length > 0
  const field = 'min-h-[42px] rounded-[10px] border border-border bg-card px-3 text-[15px] text-ink'

  return (
    <form
      className="flex flex-col gap-4"
      data-testid={testId}
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) void transport.invoke('client:connect', { address: address.trim(), code, deviceName: name.trim() })
      }}
    >
      <label className="flex flex-col gap-1 text-sm text-muted">
        {tx('client.address')}
        <input dir="ltr" className={field} data-testid="connect-address" value={address} placeholder="https://mac-mini.tailnet.ts.net" onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted">
        {tx('client.code')}
        <input dir="ltr" inputMode="numeric" maxLength={6} className={cx(field, 'font-mono tracking-[0.3em]')} data-testid="connect-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted">
        {tx('client.name')}
        <input className={field} data-testid="connect-name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {client.problem ? (
        <p className="text-[15px] text-broken" data-testid="connect-problem" data-problem={client.problem}>
          {tx(`client.problem.${client.problem}`)}
        </p>
      ) : null}
      {waiting ? (
        <p className="text-[15px] text-ink" data-testid="connect-waiting">
          {client.state === 'waiting' && client.host ? tx('client.waiting', { host: client.host.name }) : tx('client.sending')}
        </p>
      ) : null}
      <div>
        <Button type="submit" data-testid="connect-submit" disabled={!valid || waiting}>
          {tx('client.connect')}
        </Button>
      </div>
    </form>
  )
}

/** In the sidebar, in client mode: which computer, and whether it's connected. */
export function ConnectionPill(): ReactNode {
  const { tx } = useT()
  const client = useClient()
  if (!client.host || client.state === 'local' || client.state === 'pairing' || client.state === 'waiting') return null
  const state = client.state === 'open' ? 'open' : client.state === 'rejected' ? 'rejected' : 'reconnecting'
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] border border-border bg-card px-3 py-2" data-testid="connection-pill" data-state={state}>
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        <span className={cx('size-2 rounded-full', state === 'open' ? 'bg-running' : state === 'rejected' ? 'bg-broken' : 'animate-pulse bg-attention')} aria-hidden />
        <bdi>{client.host.name}</bdi>
      </span>
      <span className="text-xs text-muted">{tx(`client.pill.${state}`)}</span>
    </div>
  )
}
