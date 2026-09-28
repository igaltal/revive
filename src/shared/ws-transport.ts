import { capabilitiesFor, type Capabilities, type ClientStreamName, type ClientStreamPayload, type MethodName, type ServerStreamName } from './contract'
import { BaseTransport, RemoteError } from './transport'
import { CLOSE_REVOKED, decodeOutputFrame, WS_PROTOCOL, WS_TOKEN_PREFIX, type ClientMessage, type ServerMessage } from './ws-protocol'
import type { SessionChunk } from './contract'

export interface WsTransportOptions {
  /** ws://127.0.0.1:<port>/ws */
  url: string
  /** http://127.0.0.1:<port>, for assets. */
  httpUrl: string
  token: string
  /** Defaults to the global WebSocket (browsers, Node 22+). */
  WebSocket?: typeof WebSocket
  retry?: { minMs: number; maxMs: number }
  /** How often to check the connection is alive; a silent one is replaced. */
  heartbeatMs?: number
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
  private rejected = false
  private lastHeard = 0
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private allHandler: ((chunk: SessionChunk) => void) | null = null

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
    this.stopTimers()
    this.socket?.close()
    this.rejectPending('closed')
  }

  /**
   * Every session's output, each from wherever it is when first seen. For a
   * client that forwards output on (the desktop app in client mode).
   */
  watchAll(handler: (chunk: SessionChunk) => void): void {
    this.allHandler = handler
    this.write({ t: 'watchAll' })
  }

  /** After waking from sleep or a network change: don't wait for the backoff. */
  reconnectNow(): void {
    if (this.closed || this.rejected) return
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
      this.open()
    } else if (this.socket?.readyState === 1) {
      // It may look open while the other side is long gone: check now.
      this.write({ t: 'ping' })
    }
  }

  get state(): 'open' | 'connecting' | 'rejected' | 'closed' {
    if (this.closed) return 'closed'
    if (this.rejected) return 'rejected'
    return this.socket?.readyState === 1 ? 'open' : 'connecting'
  }

  private stopTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.heartbeat = null
    this.retryTimer = null
  }

  capabilities(): Capabilities {
    return capabilitiesFor('ws')
  }

  assetUrl(path: string): string {
    const p = path.startsWith('/') ? path : `/${path}`
    return `${this.opts.httpUrl}${p}${p.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.opts.token)}`
  }

  protected call(method: MethodName, input: unknown): Promise<unknown> {
    // Closed for good (by the caller, or because the Host refused this device): fail now, never queue.
    if (this.closed) return Promise.reject(new RemoteError(this.rejected ? 'rejected' : 'closed', this.rejected ? 'This device is no longer allowed to connect' : 'Connection closed'))
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

  protected startWatch(sessionId: string, fromOffset: number, epoch: string | undefined): void {
    this.write({ t: 'watch', s: sessionId, o: fromOffset, ...(epoch ? { e: epoch } : {}) })
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
      this.lastHeard = Date.now()
      // A connection that goes quiet (a sleeping laptop, a dropped Wi-Fi) is replaced.
      const every = this.opts.heartbeatMs ?? 10_000
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastHeard > every * 2.5) ws.close()
        else if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping' }))
      }, every)
      if (this.allHandler) ws.send(JSON.stringify({ t: 'watchAll' }))
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
      this.lastHeard = Date.now()
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
        const chunk: SessionChunk = { sessionId: header.s, offset: header.o, epoch: header.e, data, ...(header.tr ? { truncated: true } : {}) }
        this.allHandler?.(chunk)
        this.receiveChunk(chunk)
      }
    }

    ws.onclose = (ev: CloseEvent) => {
      if (this.socket !== ws) return
      this.socket = null
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.heartbeat = null
      // Calls that were sent may or may not have run: their callers decide what to do.
      // Calls still in the outbox haven't run, and go out on the next open.
      this.rejectPending('disconnected', true)
      if (this.closed) return
      if (ev.code === CLOSE_REVOKED) return this.reject()
      if (!this.opened) {
        this.firstOpen?.reject(new RemoteError('unreachable', `Couldn't connect to ${this.opts.url}`))
        this.firstOpen = null
        return
      }
      this.setConnection('reconnecting')
      // A refused reconnect may mean the device was revoked while away: ask, and stop if so.
      void this.stillAllowed().then((allowed) => {
        if (allowed === false) return this.reject()
        if (this.closed) return
        const wait = this.delay
        this.delay = Math.min(this.delay * 2, this.opts.retry?.maxMs ?? 5000)
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null
          if (!this.closed) this.open()
        }, wait)
      })
    }
  }

  /**
   * Asks the Host whether this device may still connect: false only when it
   * answered no (revoked), null when it couldn't be reached. Stops for good on false.
   */
  async checkAllowed(): Promise<boolean | null> {
    const r = await this.stillAllowed()
    if (r === false) this.reject()
    return r
  }

  /** false only when the Host answered and said this token is no good. */
  private async stillAllowed(): Promise<boolean | null> {
    try {
      const res = await fetch(`${this.opts.httpUrl}/whoami`, { headers: { authorization: `Bearer ${this.opts.token}` }, signal: AbortSignal.timeout(3000) })
      return res.status === 401 ? false : true
    } catch {
      return null
    }
  }

  private reject(): void {
    this.rejected = true
    this.closed = true
    this.outbox = []
    this.stopTimers()
    this.rejectPending('rejected')
    this.setConnection('rejected')
  }

  private rejectPending(code: string, onlySent = false): void {
    for (const [id, p] of this.pending) {
      if (onlySent && !p.sent) continue
      p.reject(new RemoteError(code, `Connection ${code}`))
      this.pending.delete(id)
    }
  }
}
