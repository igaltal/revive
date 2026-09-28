import { StrictMode, useCallback, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '../theme/theme.css'
import { applyLanguage } from '../i18n'
import { installTransport } from '@/transport'
import { BrowserTransport } from '@/transport/browser-transport'
import { AppProviders } from '@/state/AppProviders'
import { App } from '@/App'
import { WebOffline, WebPair } from './WebScreens'
import { LANG_STORE } from './LanguageSwitchLocal'
import type { Language } from '@shared/settings'

/** Not a secret: only so the offline screen can say which computer it's trying to reach. */
const LAST_HOST = 'revive.lastHost'

const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      // private mode
    }
  }
}

function startingLanguage(): Language {
  const saved = storage.get(LANG_STORE)
  if (saved === 'he' || saved === 'en') return saved
  return navigator.language.toLowerCase().startsWith('he') ? 'he' : 'en'
}

type Phase = { name: 'checking' } | { name: 'pair'; signedOutFrom: string | null } | { name: 'offline'; trying: boolean } | { name: 'app' }

/**
 * The web app: this device's cookie decides. Valid → the same app as on the
 * desktop, over the Host's WebSocket. None or revoked → pairing. Host out of
 * reach → a clear screen with the last known Host and a retry.
 */
/** Decides what this device should see; `signedOut` is called if the Host later revokes it. */
async function decide(signedOut: (hostName: string) => void): Promise<Phase> {
  let res: Response
  try {
    res = await fetch('/whoami', { credentials: 'same-origin', cache: 'no-store' })
  } catch {
    return { name: 'offline', trying: false }
  }
  if (res.status === 401) return { name: 'pair', signedOutFrom: null }
  if (!res.ok) return { name: 'offline', trying: false }
  const { hostName } = (await res.json()) as { hostName: string }
  storage.set(LAST_HOST, hostName)
  const transport = new BrowserTransport(hostName)
  transport.onConnection((s) => {
    // Revoked on the Host: signed out here at once.
    if (s === 'rejected') {
      installTransport(null)
      signedOut(hostName)
    }
  })
  try {
    await transport.connect()
  } catch {
    return { name: 'offline', trying: false }
  }
  installTransport(transport)
  return { name: 'app' }
}

function WebRoot(): ReactNode {
  const [phase, setPhase] = useState<Phase>({ name: 'checking' })
  const check = useCallback(() => {
    void decide((hostName) => setPhase({ name: 'pair', signedOutFrom: hostName })).then(setPhase)
  }, [])

  useEffect(() => {
    check()
  }, [check])

  if (phase.name === 'checking') return null
  if (phase.name === 'offline')
    return (
      <WebOffline
        hostName={storage.get(LAST_HOST)}
        trying={phase.trying}
        onRetry={() => {
          setPhase({ name: 'offline', trying: true })
          check()
        }}
      />
    )
  if (phase.name === 'pair') return <WebPair signedOutFrom={phase.signedOutFrom} onPaired={check} />
  return (
    <AppProviders>
      <App />
    </AppProviders>
  )
}

applyLanguage(startingLanguage())
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WebRoot />
  </StrictMode>
)

// The app shell works offline; everything the Host says is always fetched fresh.
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
