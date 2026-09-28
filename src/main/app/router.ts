import { METHODS, type ClientStatus, type MethodName } from '@shared/contract'
import { METHOD_NAMES } from '@shared/contract-names'
import type { Settings, SettingsPatch } from '@shared/settings'
import { ContractError, hubSink, type AppHandlers, type CallContext, type CoreHandlers, type Handlers, type SessionSink } from '../contract/dispatch'
import type { Core } from '../contract/handlers'
import type { ServerStreams } from '../contract/streams'
import type { ClientService } from '../services/client/client-service'
import type { HostService } from '../services/host/host-service'

/** Preferences of this computer's window, kept here even while working on another computer. */
const UI_KEYS = ['uiLanguage', 'claudeLanguage', 'detailLevel'] as const satisfies readonly (keyof Settings)[]

function split(patch: SettingsPatch): { ui: SettingsPatch; rest: SettingsPatch } {
  const ui: Record<string, unknown> = {}
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) ((UI_KEYS as readonly string[]).includes(k) ? ui : rest)[k] = v
  return { ui: ui as SettingsPatch, rest: rest as SettingsPatch }
}

/**
 * Decides, per call, who answers: this computer's core, or (in client mode)
 * the Host it's connected to. App methods (Host mode, the client connection)
 * are always answered here. The window hears one set of streams (`out`),
 * from whichever side is doing the work.
 */
export class AppRouter {
  constructor(
    /** What this computer's window hears. */
    readonly out: ServerStreams,
    private readonly core: Core,
    /** This computer's core, wrapped with the action log. */
    private readonly local: CoreHandlers,
    private readonly app: AppHandlers,
    private readonly client: ClientService
  ) {
    core.streams.subscribe((stream, payload) => {
      if (this.client.mode === 'local') this.out.emit(stream, payload)
    })
  }

  /** A stream from the Host, for this window (client mode only). */
  fromHost(stream: string, payload: unknown): void {
    if (this.client.mode !== 'client') return
    if (stream === 'settings:changed') return this.out.emit('settings:changed', this.withUi(payload as Settings))
    this.out.emit(stream as never, payload as never)
  }

  handlers(): Handlers {
    const all: Record<string, (input: unknown, ctx: CallContext) => unknown> = {}
    for (const name of METHOD_NAMES) {
      if ((METHODS[name] as { app: boolean }).app) {
        all[name] = this.app[name as keyof AppHandlers] as (input: unknown, ctx: CallContext) => unknown
        continue
      }
      const local = this.local[name as keyof CoreHandlers] as (input: unknown, ctx: CallContext) => unknown
      all[name] = (input, ctx) => (this.client.mode === 'client' ? this.forward(name, input) : local(input, ctx))
    }
    return all as unknown as Handlers
  }

  /** Keystrokes go where the session is. */
  sessions(): SessionSink {
    const here = hubSink(this.core.hub)
    return {
      write: (id, data) => (this.client.mode === 'client' ? this.client.write(id, data) : here.write(id, data)),
      resize: (id, cols, rows) => (this.client.mode === 'client' ? this.client.resize(id, cols, rows) : here.resize(id, cols, rows))
    }
  }

  private async forward(name: MethodName, input: unknown): Promise<unknown> {
    // The language and detail level belong to this window; everything else to the Host.
    if (name === 'settings:get') return this.withUi((await this.client.invoke(name, input)) as Settings)
    if (name === 'settings:set') {
      const { ui, rest } = split(input as SettingsPatch)
      if (Object.keys(ui).length) this.core.settings.update(ui)
      const remote = Object.keys(rest).length ? ((await this.client.invoke('settings:set', rest)) as Settings) : ((await this.client.invoke('settings:get', undefined)) as Settings)
      const merged = this.withUi(remote)
      this.out.emit('settings:changed', merged)
      return merged
    }
    return this.client.invoke(name, input)
  }

  private withUi(remote: Settings): Settings {
    const mine = this.core.settings.get()
    return { ...remote, uiLanguage: mine.uiLanguage, claudeLanguage: mine.claudeLanguage, detailLevel: mine.detailLevel }
  }
}

/** Host mode and the client connection, answered on this computer. One mode at a time. */
export function createAppHandlers(host: HostService, client: ClientService): AppHandlers {
  const notWhileClient = () => {
    if (client.mode === 'client') throw new ContractError('not_available', 'This computer is connected to another one; disconnect first to share it')
  }
  return {
    'host:status': () => host.status(),
    'host:setSharing': ({ on }) => {
      if (on) notWhileClient()
      return host.setSharing(on)
    },
    'host:setStartAtLogin': ({ on }) => host.setStartAtLogin(on),
    'host:exposeTailscale': () => host.exposeTailscale(),
    'host:startPairing': () => host.startPairing(),
    'host:cancelPairing': () => host.cancelPairing(),
    'host:answerPairing': ({ requestId, allow }) => host.answerPairing(requestId, allow),
    'host:revokeDevice': ({ deviceId }) => host.revokeDevice(deviceId),
    'host:activity': ({ limit }) => host.activity(limit),
    'client:status': (): ClientStatus => client.status(),
    'client:connect': (input) => {
      if (host.status().sharing) throw new ContractError('not_available', 'This computer is shared; stop sharing first to connect to another one')
      return client.connect(input)
    },
    'client:disconnect': () => client.disconnect()
  }
}
