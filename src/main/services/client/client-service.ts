import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { capabilitiesFor, type ClientStatus, type MethodName, type ServerStreamName } from '@shared/contract'
import { SERVER_STREAMS } from '@shared/contract-names'
import type { ClientProblem, ClientState } from '@shared/host'
import { WsTransport } from '@shared/ws-transport'
import type { SecretStore } from '../../extensions/secret-store'

/** What this app remembers about its Host. The token is stored only encrypted (safeStorage). */
interface Saved {
  address: string
  hostName: string
  deviceId: string
  /** base64 of the safeStorage-encrypted token. */
  token: string
}

export interface ClientEvents {
  /** A Host stream, to pass on to this computer's window. */
  stream(stream: ServerStreamName, payload: unknown): void
  status(status: ClientStatus): void
}

const POLL_MS = 1000
const PAIR_WAIT_MS = 5 * 60_000

/** https://name.ts.net, http://127.0.0.1:52011 → the same, without a trailing slash; anything else → null. */
export function normalizeAddress(input: string): string | null {
  let text = input.trim()
  if (!/^https?:\/\//i.test(text)) text = /^(localhost|127\.0\.0\.1)(:|$)/i.test(text) ? `http://${text}` : `https://${text}`
  try {
    const u = new URL(text)
    if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

const wsUrl = (address: string) => `${address.replace(/^http/, 'ws')}/ws`

/**
 * Client mode: this app as a window onto another computer's Revive
 * (docs/HOST_PRD.md H7). The connection lives in main: the token never
 * reaches the page, and the page keeps talking to its own main over IPC.
 */
export class ClientService {
  private transport: WsTransport | null = null
  private state: ClientState = 'local'
  private problem: ClientProblem | null = null
  private host: { name: string; address: string } | null = null
  private pairingAbort: AbortController | null = null

  constructor(
    private readonly opts: {
      userData: string
      secrets: SecretStore
      events: ClientEvents
      /** Seconds and minutes can be shortened in tests. */
      timing?: { pollMs?: number; waitMs?: number; retryMaxMs?: number; heartbeatMs?: number }
    }
  ) {}

  private get file(): string {
    return join(this.opts.userData, 'client.json')
  }

  get mode(): 'local' | 'client' {
    return this.state === 'local' || this.state === 'pairing' || this.state === 'waiting' ? 'local' : 'client'
  }

  status(): ClientStatus {
    return { state: this.state, host: this.host, problem: this.problem, capabilities: capabilitiesFor(this.mode === 'client' ? 'ws' : 'ipc') }
  }

  /** At startup: reconnect to the Host this app was paired with, without pairing again. */
  resume(): void {
    const saved = this.load()
    if (!saved) return
    if (!this.opts.secrets.isAvailable()) {
      this.set('rejected', 'no_keychain')
      return
    }
    let token: string
    try {
      token = this.opts.secrets.decrypt(Buffer.from(saved.token, 'base64'))
    } catch {
      this.set('rejected', 'no_keychain')
      return
    }
    this.host = { name: saved.hostName, address: saved.address }
    this.open(saved.address, token)
  }

  /** Sends the code shown on the Host, then waits until the user there allows this computer. */
  async connect(input: { address: string; code: string; deviceName: string }): Promise<ClientStatus> {
    const address = normalizeAddress(input.address)
    if (!address) return this.set('local', 'unreachable')
    if (!this.opts.secrets.isAvailable()) return this.set('local', 'no_keychain')
    this.pairingAbort?.abort()
    const abort = new AbortController()
    this.pairingAbort = abort
    this.set('pairing', null)

    let requestId: string
    let hostName: string
    try {
      const res = await fetch(`${address}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: input.code, deviceName: input.deviceName }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)])
      })
      const body = (await res.json()) as { requestId?: string; hostName?: string; error?: string }
      if (!res.ok || !body.requestId) {
        const reason = body.error === 'locked' ? 'locked' : body.error === 'expired' ? 'expired' : 'bad_code'
        return this.set('local', reason)
      }
      requestId = body.requestId
      hostName = body.hostName ?? address
    } catch {
      return this.set('local', 'unreachable')
    }

    this.host = { name: hostName, address }
    this.set('waiting', null)
    void this.waitForApproval(address, requestId, abort.signal)
    return this.status()
  }

  /** Forgets the Host and works on this computer again. */
  disconnect(): ClientStatus {
    this.pairingAbort?.abort()
    this.transport?.close()
    this.transport = null
    this.host = null
    if (existsSync(this.file)) rmSync(this.file)
    return this.set('local', null)
  }

  /** A core call, sent to the Host. */
  invoke(method: MethodName, input: unknown): Promise<unknown> {
    if (!this.transport) return Promise.reject(new Error('Not connected to a Host'))
    return (this.transport.invoke as (m: string, i?: unknown) => Promise<unknown>)(method, input)
  }

  write(sessionId: string, data: string): void {
    this.transport?.writeSession(sessionId, data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.transport?.resizeSession(sessionId, cols, rows)
  }

  /** The Host's picture URL, fetched here with the token (the page never sees it). */
  async asset(path: string): Promise<Response> {
    const saved = this.load()
    if (!this.transport || !saved) return new Response('Not found', { status: 404 })
    const token = this.opts.secrets.decrypt(Buffer.from(saved.token, 'base64'))
    return fetch(`${saved.address}${path}`, { headers: { authorization: `Bearer ${token}` } })
  }

  /** After the Mac wakes up or the network changes. */
  wake(): void {
    this.transport?.reconnectNow()
  }

  close(): void {
    this.pairingAbort?.abort()
    this.transport?.close()
  }

  private async waitForApproval(address: string, requestId: string, signal: AbortSignal): Promise<void> {
    const until = Date.now() + (this.opts.timing?.waitMs ?? PAIR_WAIT_MS)
    while (!signal.aborted && Date.now() < until) {
      await new Promise((r) => setTimeout(r, this.opts.timing?.pollMs ?? POLL_MS))
      let body: { state?: string; deviceId?: string; token?: string; hostName?: string }
      try {
        body = (await (await fetch(`${address}/pair/${requestId}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) })).json()) as typeof body
      } catch {
        continue // the Host may be busy or briefly unreachable; keep waiting
      }
      if (body.state === 'pending') continue
      if (body.state === 'approved' && body.token && body.deviceId) {
        const saved: Saved = {
          address,
          hostName: body.hostName ?? this.host?.name ?? address,
          deviceId: body.deviceId,
          token: this.opts.secrets.encrypt(body.token).toString('base64')
        }
        writeFileSync(this.file, JSON.stringify(saved, null, 2), { mode: 0o600 })
        this.host = { name: saved.hostName, address }
        this.open(address, body.token)
        return
      }
      this.host = null
      this.set('local', body.state === 'denied' ? 'denied' : 'expired')
      return
    }
    if (!signal.aborted) {
      this.host = null
      this.set('local', 'expired')
    }
  }

  private open(address: string, token: string): void {
    this.transport?.close()
    const t = new WsTransport({
      url: wsUrl(address),
      httpUrl: address,
      token,
      retry: { minMs: 250, maxMs: this.opts.timing?.retryMaxMs ?? 5000 },
      heartbeatMs: this.opts.timing?.heartbeatMs
    })
    this.transport = t
    // Everything the Host says goes on to this computer's window.
    for (const stream of SERVER_STREAMS) {
      if (stream === 'session:output' || stream === 'host:status' || stream === 'client:status') continue
      t.subscribe(stream, (payload: unknown) => this.opts.events.stream(stream, payload))
    }
    t.watchAll((chunk) => this.opts.events.stream('session:output', chunk))
    t.onConnection((s) => {
      if (s === 'rejected') {
        this.transport = null
        return void this.set('rejected', 'revoked')
      }
      this.set(s === 'open' ? 'open' : 'reconnecting', null)
    })
    this.set('reconnecting', null)
    // The first connection may fail (the Host restarting, say): keep trying like any reconnect.
    const first = (): void => {
      if (this.transport !== t) return
      t.connect().catch(async () => {
        // Revoked while this computer was away, or just not there yet?
        if ((await t.checkAllowed()) === false) return
        setTimeout(first, this.opts.timing?.retryMaxMs ?? 5000)
      })
    }
    first()
  }

  private set(state: ClientState, problem: ClientProblem | null): ClientStatus {
    this.state = state
    this.problem = problem
    const status = this.status()
    this.opts.events.status(status)
    return status
  }

  private load(): Saved | null {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Saved
    } catch {
      return null
    }
  }
}
