import type { UpdateStatus } from '@shared/update'

/** The part of electron-updater's autoUpdater this uses (a stand-in in tests). */
export interface Updater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  channel: string | null
  on(event: 'checking-for-update' | 'update-available' | 'update-not-available' | 'download-progress' | 'update-downloaded' | 'error', fn: (arg?: unknown) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface Timers {
  after(ms: number, fn: () => void): () => void
  every(ms: number, fn: () => void): () => void
}

const realTimers: Timers = {
  after: (ms, fn) => {
    const t = setTimeout(fn, ms)
    t.unref?.()
    return () => clearTimeout(t)
  },
  every: (ms, fn) => {
    const t = setInterval(fn, ms)
    t.unref?.()
    return () => clearInterval(t)
  }
}

export const FIRST_CHECK_MS = 60_000
export const CHECK_EVERY_MS = 6 * 60 * 60_000

/** Stable ("latest") unless this build is a prerelease (1.2.0-beta.3) or the environment says otherwise. */
export function channelFor(version: string, override?: string): 'latest' | 'beta' {
  if (override === 'beta' || override === 'latest') return override
  return /-(beta|alpha|rc)\b/i.test(version) ? 'beta' : 'latest'
}

/**
 * Updates: checked a minute after launch and every six hours, downloaded in
 * the background, and installed when Revive next quits. Nothing here ever
 * restarts Revive: only the person can (the "Update ready" note's button),
 * so a Host running agents is never restarted by an update.
 */
export class UpdateService {
  private status: UpdateStatus
  private stops: Array<() => void> = []

  constructor(
    private readonly updater: Updater,
    private readonly opts: { version: string; channel?: string; firstCheckMs?: number },
    private readonly emit: (s: UpdateStatus) => void,
    private readonly timers: Timers = realTimers
  ) {
    const channel = channelFor(opts.version, opts.channel)
    this.status = { state: 'idle', current: opts.version, version: null, channel, percent: null }
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.allowDowngrade = false
    updater.allowPrerelease = channel === 'beta'
    updater.channel = channel
    updater.on('checking-for-update', () => this.set({ state: this.status.state === 'ready' ? 'ready' : 'checking' }))
    updater.on('update-available', (info) => this.set({ state: 'downloading', version: versionOf(info), percent: 0 }))
    updater.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(Number((p as { percent?: number })?.percent ?? 0)) }))
    updater.on('update-not-available', () => this.status.state !== 'ready' && this.set({ state: 'idle' }))
    updater.on('update-downloaded', (info) => this.set({ state: 'ready', version: versionOf(info), percent: 100 }))
    // A failed check or download is quiet: it's tried again later. Never a dialog.
    updater.on('error', () => this.status.state !== 'ready' && this.set({ state: 'error' }))
  }

  start(): void {
    const check = () => void this.updater.checkForUpdates().catch(() => this.status.state !== 'ready' && this.set({ state: 'error' }))
    this.stops.push(this.timers.after(this.opts.firstCheckMs ?? FIRST_CHECK_MS, check), this.timers.every(CHECK_EVERY_MS, check))
  }

  stop(): void {
    for (const s of this.stops) s()
    this.stops = []
  }

  current(): UpdateStatus {
    return this.status
  }

  /** Only when the person asks ("Restart now"). */
  install(): void {
    if (this.status.state === 'ready') this.updater.quitAndInstall(false, true)
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit(this.status)
  }
}

function versionOf(info: unknown): string | null {
  const v = (info as { version?: unknown } | undefined)?.version
  return typeof v === 'string' ? v : null
}
