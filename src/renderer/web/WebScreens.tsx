import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'
import { LanguageSwitchLocal } from './LanguageSwitchLocal'

/** A guess at this device's name for the Host's "Allow <device>?" question. The user can change it. */
function guessName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'
  if (/Macintosh/.test(ua)) return 'Mac browser'
  return 'Browser'
}

function Shell({ children }: { children: ReactNode }): ReactNode {
  const { t } = useT()
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 min-[640px]:px-10">
        <span className="font-display text-2xl font-bold text-accent">{t('app.name')}</span>
        <LanguageSwitchLocal />
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8">{children}</main>
    </div>
  )
}

type Problem = 'bad_code' | 'locked' | 'expired' | 'denied' | 'unreachable'

/**
 * Pairing in the browser: the code on the Host's screen, then the user allows
 * it there. The Host answers with a cookie this page can't read; the page
 * never sees the token.
 */
export function WebPair({ signedOutFrom, onPaired }: { signedOutFrom: string | null; onPaired: () => void }): ReactNode {
  const { tx } = useT()
  const [code, setCode] = useState('')
  const [name, setName] = useState(guessName)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [waiting, setWaiting] = useState<{ hostName: string } | null>(null)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    []
  )

  const submit = async () => {
    setProblem(null)
    let r: Response
    try {
      r = await fetch('/pair', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, deviceName: name.trim() }) })
    } catch {
      return setProblem('unreachable')
    }
    const body = (await r.json().catch(() => ({}))) as { requestId?: string; hostName?: string; error?: string }
    if (!r.ok || !body.requestId) return setProblem(body.error === 'locked' ? 'locked' : body.error === 'expired' ? 'expired' : 'bad_code')
    setWaiting({ hostName: body.hostName ?? '' })
    const until = Date.now() + 5 * 60_000
    while (alive.current && Date.now() < until) {
      await new Promise((res) => setTimeout(res, 1000))
      const poll = (await fetch(`/pair/${body.requestId}`, { credentials: 'same-origin', cache: 'no-store' })
        .then((x) => x.json())
        .catch(() => null)) as { state?: string } | null
      if (!poll || poll.state === 'pending') continue
      if (poll.state === 'approved') return onPaired()
      setWaiting(null)
      return setProblem(poll.state === 'denied' ? 'denied' : 'expired')
    }
    setWaiting(null)
    setProblem('expired')
  }

  const field = 'min-h-[48px] rounded-[10px] border border-border bg-card px-3 text-[17px] text-ink'
  return (
    <Shell>
      <div>
        <h1 className="text-3xl leading-tight text-ink">{tx('web.pair.title')}</h1>
        <p className="mt-2 text-[15px] text-muted">{tx('web.pair.body')}</p>
      </div>
      {signedOutFrom !== null ? (
        <Notice tone="attention" testId="web-signed-out">
          <p>{signedOutFrom ? tx('web.signedOut', { host: signedOutFrom }) : tx('web.signedOutUnknown')}</p>
        </Notice>
      ) : null}
      <form
        className="flex flex-col gap-4"
        data-testid="web-pair"
        onSubmit={(e) => {
          e.preventDefault()
          if (/^\d{6}$/.test(code) && name.trim() && !waiting) void submit()
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-muted">
          {tx('client.code')}
          <input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={`${field} font-mono tracking-[0.3em]`} data-testid="web-pair-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          {tx('client.name')}
          <input className={field} data-testid="web-pair-name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {problem ? (
          <p className="text-[15px] text-broken" data-testid="web-pair-problem" data-problem={problem}>
            {tx(`client.problem.${problem}`)}
          </p>
        ) : null}
        {waiting ? (
          <p className="text-[15px] text-ink" data-testid="web-pair-waiting">
            {waiting.hostName ? tx('client.waiting', { host: waiting.hostName }) : tx('client.sending')}
          </p>
        ) : null}
        <Button type="submit" className="min-h-[48px]" data-testid="web-pair-submit" disabled={!/^\d{6}$/.test(code) || !name.trim() || waiting !== null}>
          {tx('client.connect')}
        </Button>
      </form>
    </Shell>
  )
}

/** The Host can't be reached (offline, asleep, off the private network): say so, never a blank page. */
export function WebOffline({ hostName, onRetry, trying }: { hostName: string | null; onRetry: () => void; trying: boolean }): ReactNode {
  const { tx } = useT()
  return (
    <Shell>
      <div className="flex flex-col gap-4" data-testid="web-offline">
        <h1 className="text-3xl leading-tight text-ink">{hostName ? tx('web.offline.title', { host: hostName }) : tx('web.offline.titleUnknown')}</h1>
        <p className="text-[15px] text-ink/80">{tx('web.offline.body')}</p>
        <div>
          <Button className="min-h-[48px]" data-testid="web-retry" disabled={trying} onClick={onRetry}>
            {tx('common.tryAgain')}
          </Button>
        </div>
      </div>
    </Shell>
  )
}
