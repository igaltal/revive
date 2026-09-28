import { randomBytes } from 'node:crypto'
import { VITALS_INTERVAL_MS, VITALS_LEASE_MS, type Vitals } from '@shared/vitals'
import type { RuntimeBus } from '../runtime-bus'

/** One reading of this computer, without what the service adds itself. */
export type Reading = Omit<Vitals, 'at' | 'cpuHistory' | 'tailscale' | 'devicesOnline'>

export interface VitalsSampler {
  sample(): Promise<Reading>
}

export interface VitalsSources {
  tailscale(): Vitals['tailscale']
  devicesOnline(): number | null
}

export interface Clock {
  now(): number
  every(ms: number, fn: () => void): () => void
}

const realClock: Clock = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const t = setInterval(fn, ms)
    t.unref?.()
    return () => clearInterval(t)
  }
}

const HISTORY = 60

/**
 * Samples CPU, memory, disk and the rest every 5 seconds, but only while at
 * least one client is watching (a Home screen is open somewhere). Each watch
 * is a lease that ends by itself unless renewed, so a client that
 * disappears without saying goodbye stops the sampling too.
 */
export class VitalsService {
  private readonly leases = new Map<string, number>()
  private stopTimer: (() => void) | null = null
  private latest: Vitals | null = null
  private history: number[] = []
  private sampling = false
  private sources: VitalsSources = { tailscale: () => 'missing', devicesOnline: () => null }

  constructor(
    private readonly sampler: VitalsSampler,
    private readonly bus: RuntimeBus,
    private readonly clock: Clock = realClock
  ) {}

  setSources(sources: VitalsSources): void {
    this.sources = sources
  }

  /** Starts or renews a watch. The first watch starts sampling at once. */
  watch(leaseId?: string): { leaseId: string; vitals: Vitals | null } {
    const id = leaseId && this.leases.has(leaseId) ? leaseId : randomBytes(8).toString('hex')
    this.leases.set(id, this.clock.now() + VITALS_LEASE_MS)
    if (!this.stopTimer) {
      this.stopTimer = this.clock.every(VITALS_INTERVAL_MS, () => this.tick())
      void this.sample()
    }
    return { leaseId: id, vitals: this.latest }
  }

  unwatch(leaseId: string): void {
    this.leases.delete(leaseId)
    if (this.leases.size === 0) this.stop()
  }

  /** Whether anything is being sampled right now (for tests and the log). */
  get active(): boolean {
    return this.stopTimer !== null
  }

  get watchers(): number {
    return this.leases.size
  }

  stop(): void {
    this.stopTimer?.()
    this.stopTimer = null
    this.history = []
  }

  private tick(): void {
    const now = this.clock.now()
    for (const [id, until] of this.leases) if (until <= now) this.leases.delete(id)
    if (this.leases.size === 0) return this.stop()
    void this.sample()
  }

  private async sample(): Promise<void> {
    if (this.sampling) return
    this.sampling = true
    try {
      const r = await this.sampler.sample()
      if (!this.stopTimer) return
      this.history = [...this.history, r.cpu].slice(-HISTORY)
      this.latest = {
        ...r,
        at: new Date(this.clock.now()).toISOString(),
        cpuHistory: this.history,
        tailscale: this.sources.tailscale(),
        devicesOnline: this.sources.devicesOnline()
      }
      this.bus.emit({ type: 'vitals.updated', vitals: this.latest })
    } catch (e) {
      console.error('[vitals] could not sample', e)
    } finally {
      this.sampling = false
    }
  }
}
