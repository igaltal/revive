import type {
  Capabilities,
  ClientStreamName,
  ClientStreamPayload,
  MethodInput,
  MethodName,
  MethodOutput,
  ServerStreamName,
  ServerStreamPayload,
  SessionChunk,
  TransportKind
} from './contract'
import type { StateEvent } from './runtime'

/** `invoke(method)` for methods without input, `invoke(method, input)` for the rest. */
export type InvokeArgs<M extends MethodName> = undefined extends MethodInput<M> ? [input?: MethodInput<M>] : [input: MethodInput<M>]

/** Server streams a screen can subscribe to directly. Session output is watched per session. */
export type EventStreamName = Exclude<ServerStreamName, 'session:output'>

/** `rejected`: the Host no longer accepts this device (revoked); it won't retry. */
/** Where to start watching a session: an offset, in a buffer lifetime if known. */
export interface WatchFrom {
  sessionId: string
  fromOffset: number
  epoch?: string
}

export type ConnectionState = 'open' | 'reconnecting' | 'rejected'

/**
 * How a client talks to Revive's core. The desktop renderer uses the IPC
 * bridge; a browser or phone will use a WebSocket. Screens only ever see
 * this interface, and ask capabilities() instead of checking for Electron.
 */
export interface Transport {
  readonly kind: TransportKind
  invoke<M extends MethodName>(method: M, ...input: InvokeArgs<M>): Promise<MethodOutput<M>>
  subscribe<S extends EventStreamName>(stream: S, handler: (payload: ServerStreamPayload<S>) => void): () => void
  /** A session's output from `fromOffset` on: first what's buffered, then live, with no gaps or repeats. */
  subscribe(stream: 'session:output', handler: (chunk: SessionChunk) => void, from: WatchFrom): () => void
  writeSession(sessionId: string, data: string): void
  resizeSession(sessionId: string, cols: number, rows: number): void
  /** A URL this client can load for an asset path from main (e.g. `/shots/x.png?v=1`). */
  assetUrl(path: string): string
  capabilities(): Capabilities
  onConnection(handler: (state: ConnectionState) => void): () => void
  /** Desktop only (capabilities().dropFolder): the path of a dropped folder. */
  pathForFile?(file: Blob & { name: string }): string
}

/** A call that failed on the other side, with the contract's error code (bad_input, not_available, …). */
export class RemoteError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

/** How a result travels over IPC: Electron keeps only an error's message, so the code goes in the envelope. */
export type CallEnvelope = { ok: true; v: unknown } | { ok: false; e: { code: string; message: string } }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface Watcher {
  /** The next byte this client needs. */
  next: number
  /** The buffer lifetime `next` belongs to; unknown until the first chunk. */
  epoch: string | undefined
  handlers: Set<(chunk: SessionChunk) => void>
  /** While the buffer is being read, live output waits here. */
  queue: SessionChunk[] | null
}

/**
 * What every transport does the same way: typed calls, stream fan-out, and
 * resuming. State events are applied once and in order (by sequence number);
 * session output is applied once and without gaps (by byte offset), and
 * marked `truncated` when the buffer no longer had what was missed.
 */
export abstract class BaseTransport implements Transport {
  abstract readonly kind: TransportKind
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>()
  private readonly watchers = new Map<string, Watcher>()
  private readonly connectionListeners = new Set<(s: ConnectionState) => void>()
  private lastSeq = 0
  /** Live state events that arrive while catching up wait here, so none is lost or reordered. */
  private held: StateEvent[] | null = null

  /** Sends a call and resolves with its result. */
  protected abstract call(method: MethodName, input: unknown): Promise<unknown>
  protected abstract post<S extends ClientStreamName>(stream: S, payload: ClientStreamPayload<S>): void
  /** Starts receiving a session's output from `fromOffset` (buffered first, then live). */
  protected abstract startWatch(sessionId: string, fromOffset: number, epoch: string | undefined): void
  protected abstract stopWatch(sessionId: string): void
  abstract assetUrl(path: string): string
  abstract capabilities(): Capabilities

  invoke<M extends MethodName>(method: M, ...input: InvokeArgs<M>): Promise<MethodOutput<M>> {
    return this.call(method, input[0]) as Promise<MethodOutput<M>>
  }

  subscribe<S extends EventStreamName>(stream: S, handler: (payload: ServerStreamPayload<S>) => void): () => void
  subscribe(stream: 'session:output', handler: (chunk: SessionChunk) => void, from: WatchFrom): () => void
  subscribe(stream: ServerStreamName, handler: (payload: never) => void, from?: WatchFrom): () => void {
    if (stream === 'session:output') {
      if (!from) throw new Error('session:output needs { sessionId, fromOffset }')
      const { sessionId } = from
      let w = this.watchers.get(sessionId)
      const h = handler as (c: SessionChunk) => void
      if (!w) {
        w = { next: Math.max(0, from.fromOffset), epoch: from.epoch, handlers: new Set([h]), queue: null }
        this.watchers.set(sessionId, w)
        this.startWatch(sessionId, w.next, w.epoch)
      } else {
        // A second watcher of the same session joins at the current point.
        w.handlers.add(h)
      }
      const watcher = w
      return () => {
        watcher.handlers.delete(h)
        if (watcher.handlers.size === 0 && this.watchers.get(sessionId) === watcher) {
          this.watchers.delete(sessionId)
          this.stopWatch(sessionId)
        }
      }
    }
    let set = this.listeners.get(stream)
    if (!set) this.listeners.set(stream, (set = new Set()))
    const h = handler as (p: unknown) => void
    set.add(h)
    return () => set.delete(h)
  }

  writeSession(sessionId: string, data: string): void {
    this.post('session:input', { sessionId, data })
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    this.post('session:resize', { sessionId, cols, rows })
  }

  onConnection(handler: (state: ConnectionState) => void): () => void {
    this.connectionListeners.add(handler)
    return () => this.connectionListeners.delete(handler)
  }

  /**
   * Catches up after anything that may have missed messages (a reconnect):
   * missed state events from runtime:since, then each watched session from
   * its last offset. Live events that arrive meanwhile are held and applied after.
   */
  async resume(): Promise<void> {
    this.held ??= []
    try {
      const missed = (await this.call('runtime:since', { seq: this.lastSeq })) as StateEvent[]
      const all = [...missed, ...this.held].sort((a, b) => a.seq - b.seq)
      this.held = null
      for (const e of all) this.deliverState(e)
    } finally {
      this.held = null
    }
    for (const [id, w] of this.watchers) this.startWatch(id, w.next, w.epoch)
    this.setConnection('open')
  }

  /** Where this client's state events start: the server's latest sequence number. */
  protected async baseline(): Promise<void> {
    const { seq } = (await this.call('runtime:head', undefined)) as { seq: number }
    this.lastSeq = Math.max(this.lastSeq, seq)
  }

  protected setConnection(state: ConnectionState): void {
    for (const l of this.connectionListeners) l(state)
  }

  /** Subclasses hand every incoming server stream message here. */
  protected receive(stream: ServerStreamName, payload: unknown): void {
    if (stream === 'session:output') return this.receiveChunk(payload as SessionChunk)
    if (stream === 'runtime:event') {
      if (this.held) this.held.push(payload as StateEvent)
      else this.deliverState(payload as StateEvent)
      return
    }
    this.emit(stream, payload)
  }

  /** Reads a session's buffer from its offset (for transports without a server-side watch). */
  protected fillFromBuffer(sessionId: string): void {
    const w = this.watchers.get(sessionId)
    if (!w || w.queue) return
    w.queue = []
    void (this.call('sessions:output', { sessionId, fromOffset: w.next, ...(w.epoch ? { epoch: w.epoch } : {}) }) as Promise<{ epoch: string; data: string; fromOffset: number; truncated: boolean }>).then(
      (out) => {
        const queued = w.queue ?? []
        w.queue = null
        this.applyChunk(w, sessionId, { sessionId, offset: out.fromOffset, epoch: out.epoch, data: out.data, truncated: out.truncated })
        for (const c of queued) this.applyChunk(w, sessionId, c)
      },
      () => {
        const queued = w.queue ?? []
        w.queue = null
        for (const c of queued) this.applyChunk(w, sessionId, c)
      }
    )
  }

  protected receiveChunk(chunk: SessionChunk): void {
    const w = this.watchers.get(chunk.sessionId)
    if (!w) return
    if (w.queue) w.queue.push(chunk)
    else this.applyChunk(w, chunk.sessionId, chunk)
  }

  private applyChunk(w: Watcher, sessionId: string, chunk: SessionChunk): void {
    // A new buffer lifetime (Revive restarted and rebuilt it from tmux): start over from it.
    let reset = false
    if (w.epoch !== undefined && chunk.epoch !== w.epoch) {
      reset = true
      w.next = 0
    }
    w.epoch = chunk.epoch
    const bytes = encoder.encode(chunk.data)
    const end = chunk.offset + bytes.length
    if (!reset && end <= w.next && !(chunk.truncated && chunk.offset > w.next)) return // already seen
    let { offset, data } = chunk
    let truncated = chunk.truncated === true
    if (offset < w.next) {
      data = decoder.decode(bytes.subarray(w.next - offset))
      offset = w.next
    } else if (offset > w.next) {
      truncated = true // what was between is no longer in the buffer
    }
    w.next = Math.max(w.next, end)
    const out: SessionChunk = { sessionId, offset, epoch: chunk.epoch, data, ...(truncated ? { truncated } : {}), ...(reset ? { reset } : {}) }
    for (const h of w.handlers) h(out)
  }

  private deliverState(e: StateEvent): void {
    if (e.seq <= this.lastSeq) return
    this.lastSeq = e.seq
    this.emit('runtime:event', e)
  }

  private emit(stream: string, payload: unknown): void {
    for (const h of this.listeners.get(stream) ?? []) {
      try {
        h(payload)
      } catch (e) {
        console.error(`[transport] ${stream} handler failed`, e)
      }
    }
  }
}

/** What the desktop preload exposes as `window.revive`: raw, name-checked IPC. IpcTransport wraps it. */
export interface DesktopBridge {
  invoke(method: string, input: unknown): Promise<unknown>
  on(stream: string, listener: (payload: unknown) => void): () => void
  send(stream: string, payload: unknown): void
  pathForFile(file: Blob & { name: string }): string
}
