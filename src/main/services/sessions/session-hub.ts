import { sessionKey, type RunStep, type SessionKey, type SessionRef } from '@shared/runtime'
import { redact } from '@shared/redact'
import { splitLines, stripAnsi } from '@shared/ansi'
import type { RuntimeBus } from '../runtime-bus'
import type { SessionBackend, SessionExit, SessionHandle, SessionSpec } from './backend'

const LOG_LINES = 400
const IDLE_FLUSH_MS = 150
const MAX_PENDING = 4096
const SPINNER = /^[\u2800-\u28FF]+\s?/

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
 * Owns every terminal session by its stable identity (project + agent),
 * masks secrets in their output, keeps a short log, and publishes
 * started / output / exited on the runtime bus.
 */
export class SessionHub {
  private readonly live = new Map<SessionKey, Live>()
  private readonly logs = new Map<SessionKey, { lines: string[]; rest: string }>()

  constructor(
    private readonly backend: SessionBackend,
    private readonly bus: RuntimeBus
  ) {}

  /** Starts a session. A session with the same identity must have ended first. */
  start(spec: StartSpec): { handle: SessionHandle; exited: Promise<SessionExit> } {
    const key = sessionKey(spec.ref)
    if (this.live.has(key)) throw new Error(`Session ${key} is already running`)
    const handle = this.backend.spawn(spec)
    // A command can carry a key inline (API_TOKEN=… npm run dev): mask it like any output.
    const display = redact(spec.display, spec.secrets)
    this.bus.emit({ type: 'process.started', session: spec.ref, step: spec.step, command: display, backend: this.backend.kind })
    this.appendLog(key, `$ ${display}\n`)

    // Output is masked a line at a time, so a secret is never split across two events.
    let pending = ''
    let timer: NodeJS.Timeout | null = null
    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (!pending) return
      const data = redact(pending, spec.secrets)
      pending = ''
      this.appendLog(key, data)
      this.bus.emit({ type: 'process.output', session: spec.ref, data })
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
        this.flushLog(key)
        if (this.live.get(key)?.handle === handle) this.live.delete(key)
        this.bus.emit({ type: 'process.exited', session: spec.ref, step: spec.step, exitCode: exit.exitCode, signal: exit.signal })
        resolve(exit)
      })
    })
    this.live.set(key, { handle, step: spec.step, exited })
    return { handle, exited }
  }

  get(ref: SessionRef): SessionHandle | undefined {
    return this.live.get(sessionKey(ref))?.handle
  }

  list(): Array<{ ref: SessionRef; step: RunStep }> {
    return [...this.live.values()].map((l) => ({ ref: l.handle.ref, step: l.step }))
  }

  async kill(ref: SessionRef): Promise<void> {
    const l = this.live.get(sessionKey(ref))
    if (!l) return
    await l.handle.kill()
    await l.exited
  }

  async killAll(): Promise<void> {
    await Promise.all([...this.live.values()].map((l) => l.handle.kill().then(() => l.exited)))
  }

  /** Recent output, masked, without colour codes. */
  log(ref: SessionRef): string[] {
    const l = this.logs.get(sessionKey(ref))
    if (!l) return []
    return l.rest.trim() ? [...l.lines, stripAnsi(l.rest)] : [...l.lines]
  }

  clearLog(ref: SessionRef): void {
    this.logs.delete(sessionKey(ref))
  }

  private appendLog(key: SessionKey, text: string): void {
    const l = this.logs.get(key) ?? { lines: [], rest: '' }
    const split = splitLines(l.rest, stripAnsi(text))
    // Spinner frames (npm, pnpm) are animation, not output.
    l.lines.push(...split.lines.map((line) => line.replace(SPINNER, '')).filter((line) => line.trim().length > 0))
    if (l.lines.length > LOG_LINES) l.lines.splice(0, l.lines.length - LOG_LINES)
    l.rest = split.rest
    this.logs.set(key, l)
  }

  private flushLog(key: SessionKey): void {
    const l = this.logs.get(key)
    if (l?.rest.trim()) {
      l.lines.push(l.rest)
      l.rest = ''
    }
  }
}
