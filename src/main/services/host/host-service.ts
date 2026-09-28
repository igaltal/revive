import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import QRCode from 'qrcode'
import type { HostStatus, PairingCode } from '@shared/host'
import type { Exec } from '../../exec'
import type { Core } from '../../contract/handlers'
import { noAppHandlers, type CoreHandlers } from '../../contract/dispatch'
import { startHostServer, type HostServer } from '../../contract/host-server'
import type { ServerStreams } from '../../contract/streams'
import { ActionLog } from './action-log'
import { DeviceRegistry } from './devices'
import { Pairing } from './pairing'

/** What only the desktop app can do for Host mode. */
export interface HostPlatform {
  hostName: string
  exec: Exec
  /** powerSaveBlocker 'prevent-app-suspension' while sharing. */
  keepAwake(on: boolean): void
  loginItem: { get(): boolean; set(on: boolean): void }
  /** Sharing turned on or off: the menu bar icon, and whether closing the window quits. */
  sharingChanged(on: boolean): void
}

const TAILSCALE_APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'

/**
 * Host mode: this computer shared with paired devices (docs/HOST_PRD.md H1, H8).
 * The server listens on 127.0.0.1 only; `tailscale serve` (after the user
 * confirmed it) makes it reachable on their tailnet with real HTTPS.
 */
export class HostService {
  readonly devices: DeviceRegistry
  readonly pairing: Pairing
  readonly log: ActionLog
  private server: HostServer | null = null
  private saved: { sharing: boolean; port: number | null }
  private tailscale: HostStatus['tailscale'] = { state: 'missing', address: null }
  private tailnetName: string | null = null
  private sleepMinutes: number | null = null
  private pairingCode: PairingCode | null = null

  constructor(
    private readonly opts: {
      userData: string
      core: Core
      /** The core handlers remote devices may call, already wrapped with the action log. */
      handlers: CoreHandlers
      /** This computer's own window. */
      out: ServerStreams
      /** The action log (userData/action-log.jsonl). */
      log: ActionLog
      platform: HostPlatform
      checkOutputs: boolean
    }
  ) {
    this.devices = new DeviceRegistry(join(opts.userData, 'devices.json'))
    this.log = opts.log
    this.pairing = new Pairing(this.devices, () => this.emit())
    this.saved = this.load()
  }

  /** At startup: sharing comes back on by itself if it was on (after a reboot, say). */
  async init(): Promise<void> {
    await this.refreshSystem()
    if (this.saved.sharing) await this.start().catch((e: unknown) => console.error('[host] could not start sharing', e))
    this.emit()
  }

  status(): HostStatus {
    const online = this.server?.onlineDevices() ?? new Set<string>()
    const code = this.pairing.current()
    const locked = this.pairing.locked()
    return {
      sharing: this.server !== null,
      port: this.server?.port ?? this.saved.port,
      hostName: this.opts.platform.hostName,
      tailscale: this.tailscale,
      sleepMinutes: this.sleepMinutes,
      startAtLogin: this.opts.platform.loginItem.get(),
      pairing: code && this.pairingCode?.code === code.code ? this.pairingCode : null,
      lockedUntil: locked ? new Date(locked).toISOString() : null,
      requests: this.pairing.pending().map((r) => ({ id: r.id, deviceName: r.deviceName, at: new Date(r.at).toISOString() })),
      devices: this.devices.active().map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, online: online.has(d.id) }))
    }
  }

  async setSharing(on: boolean): Promise<HostStatus> {
    if (on) await this.start()
    else await this.stop()
    this.saved.sharing = on
    this.save()
    await this.refreshSystem()
    this.emit()
    return this.status()
  }

  setStartAtLogin(on: boolean): HostStatus {
    this.opts.platform.loginItem.set(on)
    this.emit()
    return this.status()
  }

  /** Runs exactly `tailscale serve --bg <port>`. The window asks the user first. */
  async exposeTailscale(): Promise<HostStatus> {
    if (!this.server) throw new Error('Turn on sharing first')
    const r = await this.tailscaleCli(['serve', '--bg', String(this.server.port)], 20_000)
    if (r.code !== 0) this.tailscale = { state: 'error', address: null, detail: (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ').slice(0, 300) }
    else await this.refreshSystem()
    this.emit()
    return this.status()
  }

  async startPairing(): Promise<PairingCode> {
    if (!this.server) throw new Error('Turn on sharing first')
    const { code, expiresAt } = this.pairing.start()
    const base = this.tailscale.state === 'serving' && this.tailscale.address ? this.tailscale.address : this.server.httpUrl
    const link = `${base}/pair?code=${code}`
    this.pairingCode = { code, expiresAt: new Date(expiresAt).toISOString(), link, qrSvg: await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) }
    this.emit()
    return this.pairingCode
  }

  cancelPairing(): void {
    this.pairingCode = null
    this.pairing.cancel()
  }

  answerPairing(requestId: string, allow: boolean): HostStatus {
    this.pairing.answer(requestId, allow)
    this.emit()
    return this.status()
  }

  /** Its token stops working now, and its live connections close right away. */
  revokeDevice(deviceId: string): HostStatus {
    this.devices.revoke(deviceId)
    this.server?.disconnectDevice(deviceId)
    this.emit()
    return this.status()
  }

  activity(limit: number) {
    return this.log.latest(limit)
  }

  /** For tests and the menu: the live server, if sharing. */
  get live(): HostServer | null {
    return this.server
  }

  async stop(): Promise<void> {
    const s = this.server
    this.server = null
    this.pairingCode = null
    this.pairing.cancel()
    if (s) await s.close()
    this.opts.platform.keepAwake(false)
    this.opts.platform.sharingChanged(false)
  }

  private async start(): Promise<void> {
    if (this.server) return
    const { core } = this.opts
    const make = (port: number | undefined) =>
      startHostServer({
        // Remote devices get the core only; Host controls stay on this computer.
        handlers: { ...this.opts.handlers, ...noAppHandlers() },
        streams: core.streams,
        hub: core.hub,
        devices: this.devices,
        pairing: this.pairing,
        hostName: this.opts.platform.hostName,
        assets: () => core.workspace.projectIds(),
        publicHosts: () => (this.tailnetName ? [this.tailnetName] : []),
        port,
        checkOutputs: this.opts.checkOutputs,
        onDevicesChanged: () => this.emit()
      })
    // The same port as last time, so `tailscale serve` and paired devices keep working after a restart.
    this.server = await make(this.saved.port ?? undefined).catch(() => make(undefined))
    this.saved.port = this.server.port
    this.save()
    this.opts.platform.keepAwake(true)
    this.opts.platform.sharingChanged(true)
  }

  private async refreshSystem(): Promise<void> {
    const pm = await this.opts.platform.exec('/usr/bin/pmset', ['-g'], { timeoutMs: 5000 })
    const m = /^\s*sleep\s+(\d+)/m.exec(pm.stdout)
    this.sleepMinutes = pm.code === 0 && m ? Number(m[1]) : null
    await this.detectTailscale()
  }

  private async detectTailscale(): Promise<void> {
    const st = await this.tailscaleCli(['status', '--json'], 5000)
    if (st.code === 127) {
      this.tailscale = { state: 'missing', address: null }
      return
    }
    let name: string | null
    try {
      const data = JSON.parse(st.stdout) as { BackendState?: string; Self?: { DNSName?: string } }
      if (data.BackendState !== 'Running') {
        this.tailscale = { state: 'error', address: null, detail: `Tailscale is ${data.BackendState ?? 'not running'}` }
        return
      }
      name = data.Self?.DNSName?.replace(/\.$/, '') ?? null
    } catch {
      this.tailscale = { state: 'error', address: null, detail: (st.stderr || 'Tailscale did not answer').trim().slice(0, 300) }
      return
    }
    this.tailnetName = name
    const port = this.server?.port ?? this.saved.port
    const sv = await this.tailscaleCli(['serve', 'status', '--json'], 5000)
    const serving = port !== null && sv.code === 0 && new RegExp(`(127\\.0\\.0\\.1|localhost):${port}\\b`).test(sv.stdout)
    this.tailscale = serving && name ? { state: 'serving', address: `https://${name}` } : { state: 'available', address: null }
  }

  private async tailscaleCli(args: string[], timeoutMs: number) {
    const r = await this.opts.platform.exec('tailscale', args, { timeoutMs })
    if (r.code !== 127 || !existsSync(TAILSCALE_APP)) return r
    return this.opts.platform.exec(TAILSCALE_APP, args, { timeoutMs })
  }

  private emit(): void {
    this.opts.out.emit('host:status', this.status())
  }

  private load(): { sharing: boolean; port: number | null } {
    try {
      const d = JSON.parse(readFileSync(join(this.opts.userData, 'host.json'), 'utf8')) as { sharing?: unknown; port?: unknown }
      return { sharing: d.sharing === true, port: typeof d.port === 'number' ? d.port : null }
    } catch {
      return { sharing: false, port: null }
    }
  }

  private save(): void {
    writeFileSync(join(this.opts.userData, 'host.json'), JSON.stringify(this.saved, null, 2))
  }
}
