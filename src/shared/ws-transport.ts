import { capabilitiesFor, type Capabilities, type ClientStreamName, type ClientStreamPayload, type MethodName, type ServerStreamName } from './contract'
import { BaseTransport, RemoteError } from './transport'
import { decodeOutputFrame, WS_PROTOCOL, WS_TOKEN_PREFIX, type ClientMessage, type ServerMessage } from './ws-protocol'

export interface WsTransportOptions {
  /** ws://127.0.0.1:<port>/ws */
  url: string
  /** http://127.0.0.1:<port>, for assets. */
  httpUrl: string
  token: string
  /** Defaults to the global WebSocket (browsers, Node 22+). */
  WebSocket?: typeof WebSocket
  retry?: { minMs: number; maxMs: number }
}

export { RemoteError }

/**
 * The contract over a WebSocket. Reconnects on its own and resumes: missed
 * state events come from runtime:since, and each watched session continues
 * from its byte offset (the server sends what's buffered first).
 */
export class WsTransport extends BaseTransport {
  readonly kind = 'ws' as const
  private socket: WebSocket | null = null
  private nextId = 1
  /** `sent` is false while a call waits in the outbox: such a call has not run, so it isn't failed on a disconnect. */
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; sent: boolean }>()
  /** Messages written while disconnected, sent on the next open. */
  private outbox: Array<{ text: string; callId?: number }> = []
  private closed = false
  private opened = false
  private delay: number
  private firstOpen: { resolve: () => void; reject: (e: Error) => void } | null = null

  constructor(private readonly opts: WsTransportOptions) {
    super()
    this.delay = opts.retry?.minMs ?? 250
  }

  /** Opens the connection; resolves once the first connection is ready. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.firstOpen = { resolve, reject }
      this.open()
    })
  }

  close(): void {
    this.closed = true
    this.socket?.close()
    this.rejectPending('closed')
  }

  capabilities(): Capabilities {
    return capabilitiesFor('ws')
  }

  assetUrl(path: string): string {
    const p = path.startsWith('/') ? path : `/${path}`
    return `${this.opts.httpUrl}${p}${p.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.opts.token)}`
  }

  protected call(method: MethodName, input: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, sent: false })
      this.write({ t: 'call', id, m: method, i: input })
    })
  }

  protected post<S extends ClientStreamName>(stream: S, payload: ClientStreamPayload<S>): void {
    if (stream === 'session:input') {
      const p = payload as ClientStreamPayload<'session:input'>
      this.write({ t: 'input', s: p.sessionId, d: p.data })
    } else {
      const p = payload as ClientStreamPayload<'session:resize'>
      this.write({ t: 'resize', s: p.sessionId, c: p.cols, r: p.rows })
    }
  }

  protected startWatch(sessionId: string, fromOffset: number): void {
    this.write({ t: 'watch', s: sessionId, o: fromOffset })
  }

  protected stopWatch(sessionId: string): void {
    this.write({ t: 'unwatch', s: sessionId })
  }

  private write(msg: ClientMessage): void {
    const text = JSON.stringify(msg)
    const callId = msg.t === 'call' ? msg.id : undefined
    if (this.socket?.readyState === 1) {
      this.socket.send(text)
      this.markSent(callId)
    } else {
      this.outbox.push({ text, callId })
    }
  }

  private markSent(callId: number | undefined): void {
    const p = callId === undefined ? undefined : this.pending.get(callId)
    if (p) p.sent = true
  }

  private open(): void {
    const Impl = this.opts.WebSocket ?? globalThis.WebSocket
    const ws = new Impl(this.opts.url, [WS_PROTOCOL, `${WS_TOKEN_PREFIX}${this.opts.token}`])
    ws.binaryType = 'arraybuffer'
    this.socket = ws

    ws.onopen = () => {
      this.delay = this.opts.retry?.minMs ?? 250
      const queued = this.outbox
      this.outbox = []
      for (const { text, callId } of queued) {
        ws.send(text)
        this.markSent(callId)
      }
      if (this.opened) {
        void this.resume().catch(() => ws.close())
      } else {
        this.opened = true
        void this.baseline().then(
          () => {
            this.setConnection('open')
            this.firstOpen?.resolve()
            this.firstOpen = null
          },
          (e: Error) => this.firstOpen?.reject(e)
        )
      }
    }

    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') {
        let msg: ServerMessage
        try {
          msg = JSON.parse(ev.data) as ServerMessage
        } catch {
          return
        }
        if (msg.t === 'ret') {
          const p = this.pending.get(msg.id)
          if (!p) return
          this.pending.delete(msg.id)
          if (msg.ok) p.resolve(msg.v)
          else p.reject(new RemoteError(msg.e.code, msg.e.message))
        } else if (msg.t === 'ev') {
          this.receive(msg.s as ServerStreamName, msg.p)
        }
      } else {
        const { header, data } = decodeOutputFrame(ev.data as ArrayBuffer)
        this.receiveChunk({ sessionId: header.s, offset: header.o, data, ...(header.tr ? { truncated: true } : {}) })
      }
    }

    ws.onclose = () => {
      if (this.socket !== ws) return
      this.socket = null
      // Calls that were sent may or may not have run: their callers decide what to do.
      // Calls still in the outbox haven't run, and go out on the next open.
      this.rejectPending('disconnected', true)
      if (this.closed) return
      if (!this.opened) {
        this.firstOpen?.reject(new RemoteError('unreachable', `Couldn't connect to ${this.opts.url}`))
        this.firstOpen = null
        return
      }
      this.setConnection('reconnecting')
      const wait = this.delay
      this.delay = Math.min(this.delay * 2, this.opts.retry?.maxMs ?? 5000)
      setTimeout(() => !this.closed && this.open(), wait)
    }
  }

  private rejectPending(code: string, onlySent = false): void {
    for (const [id, p] of this.pending) {
      if (onlySent && !p.sent) continue
      p.reject(new RemoteError(code, `Connection ${code}`))
      this.pending.delete(id)
    }
  }
}
