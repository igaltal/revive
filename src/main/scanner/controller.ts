import { randomUUID } from 'node:crypto'
import type { ScanDone, ScanProgress } from '@shared/scan'
import type { AgentAdapter } from './agent-adapter'
import { runScan } from './scan'

/** One scan at a time for the whole app. */
export class ScanController {
  private current: { scanId: string; folder: string; abort: AbortController } | null = null

  constructor(
    private readonly adapter: AgentAdapter,
    private readonly events: { progress: (p: ScanProgress) => void; done: (d: ScanDone) => void }
  ) {}

  start(folder: string, model: string): { scanId: string } {
    if (this.current) return { scanId: this.current.scanId }
    const scanId = randomUUID()
    const abort = new AbortController()
    this.current = { scanId, folder, abort }
    void runScan(folder, { adapter: this.adapter, model, scanId, signal: abort.signal, onProgress: this.events.progress })
      .catch((e: unknown): ScanDone => ({ scanId, ok: false, costUsd: null, error: { code: 'unknown', detail: [String((e as Error)?.message ?? e)] } }))
      .then((done) => {
        this.current = null
        this.events.done(done)
      })
    return { scanId }
  }

  cancel(scanId: string): void {
    if (this.current?.scanId === scanId) this.current.abort.abort()
  }

  active(): { scanId: string; folder: string } | null {
    return this.current ? { scanId: this.current.scanId, folder: this.current.folder } : null
  }

  /** On quit: the Claude process must not outlive Revive. */
  abortAll(): void {
    this.current?.abort.abort()
  }
}
