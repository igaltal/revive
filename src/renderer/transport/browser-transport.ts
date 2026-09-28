import { capabilitiesFor, type ClientStatus, type MethodName, type ServerStreamName } from '@shared/contract'
import type { Settings, SettingsPatch } from '@shared/settings'
import { RemoteError } from '@shared/transport'
import { WsTransport } from '@shared/ws-transport'

/** This device's own preferences: the language and detail level stay here, the rest is the Host's. */
const UI_KEYS = ['uiLanguage', 'claudeLanguage', 'detailLevel'] as const
const UI_STORE = 'revive.ui'

function readUi(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(UI_STORE) ?? '{}') as Partial<Settings>
  } catch {
    return {}
  }
}

/**
 * The web app's transport: the Host's WebSocket protocol, on the page's own
 * origin. It carries no token: the browser sends its HttpOnly device cookie,
 * which no script here can read. App-level calls (the connection, signing
 * out, this device's preferences) are answered here.
 */
export class BrowserTransport extends WsTransport {
  private status: ClientStatus

  constructor(hostName: string) {
    super({
      url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
      httpUrl: location.origin,
      retry: { minMs: 500, maxMs: 5000 }
    })
    this.status = { state: 'reconnecting', host: { name: hostName, address: location.origin }, problem: null, capabilities: capabilitiesFor('ws') }
    this.onConnection((s) => this.setStatus(s === 'open' ? 'open' : s === 'rejected' ? 'rejected' : 'reconnecting'))
  }

  protected override async call(method: MethodName, input: unknown): Promise<unknown> {
    if (method === 'client:status') return this.status
    if (method === 'client:disconnect') {
      // Signing out ends this device on the Host and removes the cookie.
      await fetch('/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
      location.reload()
      return { ...this.status, state: 'local' }
    }
    if (method.startsWith('host:') || method === 'client:connect') throw new RemoteError('not_available', `${method} isn't available in the browser`)
    if (method === 'settings:get') return this.withUi((await super.call(method, input)) as Settings)
    if (method === 'settings:set') {
      const patch = input as SettingsPatch
      const ui: Record<string, unknown> = {}
      const rest: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(patch)) ((UI_KEYS as readonly string[]).includes(k) ? ui : rest)[k] = v
      if (Object.keys(ui).length) {
        try {
          localStorage.setItem(UI_STORE, JSON.stringify({ ...readUi(), ...ui }))
        } catch {
          // private mode: the choice lasts until the page closes
        }
      }
      const remote = (await super.call(Object.keys(rest).length ? 'settings:set' : 'settings:get', Object.keys(rest).length ? rest : undefined)) as Settings
      const merged = this.withUi({ ...remote, ...ui } as Settings)
      super.receive('settings:changed', merged)
      return merged
    }
    return super.call(method, input)
  }

  protected override receive(stream: ServerStreamName, payload: unknown): void {
    super.receive(stream, stream === 'settings:changed' ? this.withUi(payload as Settings) : payload)
  }

  private withUi(remote: Settings): Settings {
    const mine = readUi()
    const out = { ...remote }
    for (const k of UI_KEYS) if (mine[k] !== undefined) (out as Record<string, unknown>)[k] = mine[k]
    return out
  }

  private setStatus(state: ClientStatus['state']): void {
    this.status = { ...this.status, state, problem: state === 'rejected' ? 'revoked' : null }
    super.receive('client:status', this.status)
  }
}
