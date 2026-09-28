import { sessionId, type RunStep, type SessionId, type SessionOutput, type SessionRef } from '@shared/runtime'
import { redact } from '@shared/redact'
import { splitLines, stripAnsi } from '@shared/ansi'
import type { RuntimeBus } from '../runtime-bus'
import type { ExistingSession, SessionBackend, SessionExit, SessionHandle, SessionSpec } from './backend'
import { OutputBuffer } from './output-buffer'

const LOG_LINES = 400
const IDLE_FLUSH_MS = 150
const MAX_PENDING = 4096
/** Spinner frames (npm, pnpm) are animation, not output. */
const SPINNER = /^[⠀-⣿]+\s?/

export interface StartSpec extends SessionSpec {
  step: RunStep
  /** What Technical details shows as the command. */
  display: string
  /** Exact values from the project's .env files, masked in all output. */
  secrets: readonly string[]
}

interface Live {
  handle: SessionHandle
  step: RunStep
  exited: Promise<SessionExit>
}

/**
 * Owns every terminal session by its stable identity (project + kind),
 * masks secrets in their output, keeps each session's output in its own
 * buffer, and publishes started / output / exited on the runtime bus.
 */
export class SessionHub {
  private readonly live = new Map<SessionId, Live>()
  private readonly buffers = new Map<SessionId, OutputBuffer>()
  /** Where the current "log" starts in each buffer (the runner resets it per start). */
  private readonly marks = new Map<SessionId, number>()

  constructor(
    private readonly backend: SessionBackend,
    private readonly bus: RuntimeBus
  ) {}

  /** Starts a session. A session with the same identity must have ended first. */
  start(spec: StartSpec): { handle: SessionHandle; exited: Promise<SessionExit> } {
    const id = sessionId(spec.ref)
    if (this.live.has(id)) throw new Error(`Session ${id} is already running`)
    const handle = (this.backend.spawn as (s: StartSpec) => SessionHandle)(spec)
    return this.track(spec.ref, handle, spec.step, spec.display, spec.secrets)
  }

  /**
   * Takes over a session left running by an earlier Revive (tmux). Its history
   * comes first, so the output buffer is rebuilt from it (as a new epoch).
   */
  adopt(existing: ExistingSession & { ref: SessionRef }, opts: { step: RunStep; display: string; secrets: readonly string[] }): { handle: SessionHandle; exited: Promise<SessionExit> } {
    const id = sessionId(existing.ref)
    const current = this.live.get(id)
    if (current) return { handle: current.handle, exited: current.exited }
    return this.track(existing.ref, this.backend.attach(existing), opts.step, opts.display, opts.secrets)
  }

  /** Whether sessions outlive Revive (tmux). */
  get persistent(): boolean {
    return this.backend.persistent
  }

  get backendKind(): 'pty' | 'tmux' {
    return this.backend.kind
  }

  /** Resolves when the session ends (not when it's detached). */
  whenExited(ref: SessionRef): Promise<SessionExit> | null {
    return this.live.get(sessionId(ref))?.exited ?? null
  }

  /** Stops watching sessions without ending them (quitting while they keep running). */
  async detachAll(keep: (ref: SessionRef) => boolean = () => true): Promise<void> {
    await Promise.all(
      [...this.live.entries()]
        .filter(([, l]) => keep(l.handle.ref))
        .map(async ([id, l]) => {
          this.live.delete(id)
          await l.handle.detach()
        })
    )
  }

  private track(ref: SessionRef, handle: SessionHandle, step: RunStep, rawDisplay: string, secrets: readonly string[]): { handle: SessionHandle; exited: Promise<SessionExit> } {
    const id = sessionId(ref)
    // A command can carry a key inline (API_TOKEN=… npm run dev): mask it like any output.
    const display = redact(rawDisplay, secrets)
    this.bus.emit({ type: 'process.started', session: ref, step, command: display, backend: this.backend.kind })
    this.write(ref, `$ ${display}\r\n`)

    // Output is masked a line at a time, so a secret is never split across two writes.
    let pending = ''
    let timer: NodeJS.Timeout | null = null
    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (!pending) return
      const data = redact(pending, secrets)
      pending = ''
      this.write(ref, data)
    }
    const offData = handle.onData((chunk) => {
      pending += chunk
      const cut = pending.lastIndexOf('\n')
      if (cut >= 0 || pending.length > MAX_PENDING) {
        const upTo = cut >= 0 ? cut + 1 : pending.length
        const rest = pending.slice(upTo)
        pending = pending.slice(0, upTo)
        flush()
        pending = rest
      }
      if (pending && !timer) timer = setTimeout(flush, IDLE_FLUSH_MS)
    })

    const exited = new Promise<SessionExit>((resolve) => {
      handle.onExit((exit) => {
        flush()
        offData()
        if (this.live.get(id)?.handle === handle) this.live.delete(id)
        this.bus.emit({ type: 'process.exited', session: ref, step, exitCode: exit.exitCode, signal: exit.signal })
        resolve(exit)
      })
    })
    this.live.set(id, { handle, step, exited })
    return { handle, exited }
  }

  get(ref: SessionRef): SessionHandle | undefined {
    return this.live.get(sessionId(ref))?.handle
  }

  list(): Array<{ ref: SessionRef; step: RunStep }> {
    return [...this.live.values()].map((l) => ({ ref: l.handle.ref, step: l.step }))
  }

  async kill(ref: SessionRef): Promise<void> {
    const l = this.live.get(sessionId(ref))
    if (!l) return
    await l.handle.kill()
    await l.exited
  }

  async killAll(): Promise<void> {
    await Promise.all([...this.live.values()].map((l) => l.handle.kill().then(() => l.exited)))
  }

  /** Raw output (masked, with colour codes) after `fromOffset`, for terminals and late clients. */
  /**
   * Output after `fromOffset`. An offset from another epoch (before a Revive
   * restart) counts from the start of this one, marked truncated.
   */
  output(id: SessionId, fromOffset: number, epoch?: string): SessionOutput {
    const buffer = this.bufferFor(id)
    const stale = epoch !== undefined && epoch !== buffer.epoch
    const r = buffer.read(stale ? 0 : fromOffset)
    return { sessionId: id, epoch: buffer.epoch, ...r, truncated: r.truncated || (stale && fromOffset > 0) }
  }

  /** Readable output since the last `clearLog`: masked, without colour codes or spinners. */
  log(ref: SessionRef): string[] {
    const id = sessionId(ref)
    const buffer = this.buffers.get(id)
    if (!buffer) return []
    const { data } = buffer.read(this.marks.get(id) ?? 0)
    const { lines, rest } = splitLines('', stripAnsi(data))
    return [...lines, rest]
      .map((l) => l.replace(SPINNER, ''))
      .filter((l) => l.trim().length > 0)
      .slice(-LOG_LINES)
  }

  /** Starts a fresh log (the buffer itself, and its offsets, carry on). */
  clearLog(ref: SessionRef): void {
    const id = sessionId(ref)
    this.marks.set(id, this.buffers.get(id)?.endOffset ?? 0)
  }

  private bufferFor(id: SessionId): OutputBuffer {
    let buffer = this.buffers.get(id)
    if (!buffer) this.buffers.set(id, (buffer = new OutputBuffer()))
    return buffer
  }

  private write(ref: SessionRef, data: string): void {
    const buffer = this.bufferFor(sessionId(ref))
    const offset = buffer.append(data)
    this.bus.emitOutput({ session: ref, data, offset, epoch: buffer.epoch })
  }
}
