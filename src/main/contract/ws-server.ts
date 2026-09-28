import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { SERVER_STREAMS } from '@shared/contract-names'
import { parseSessionId, sessionId as toSessionId, type SessionId } from '@shared/runtime'
import { encodeOutputFrame, WS_PROTOCOL, WS_TOKEN_PREFIX, type ClientMessage, type ServerMessage } from '@shared/ws-protocol'
import type { SessionHub } from '../services/sessions/session-hub'
import { resolveAssetRequest } from '../services/shots/shots'
import { ContractError, dispatch, handleClientStream, type Handlers } from './dispatch'
import type { ServerStreams } from './streams'

/** Above this much unsent data, session output waits and is caught up from the session buffer. */
const OUTPUT_HIGH_WATER = 512 * 1024
/** A client this far behind on state events is disconnected; it resumes with runtime:since. */
const STATE_LIMIT = 16 * 1024 * 1024
const CATCH_UP_EVERY_MS = 50

export interface DevWsServer {
  url: string
  httpUrl: string
  token: string
  port: number
  /** Drops every connection (clients reconnect and resume). For tests. */
  dropAll(): void
  close(): Promise<void>
}

interface Watch {
  /** The next byte this client needs. */
  next: number
}

interface Conn {
  ws: WebSocket
  watches: Map<SessionId, Watch>
}

/** Contract errors carry a code; anything else (a service throwing) is just 'failed'. Node's own errno codes stay inside. */
const errorCode = (e: unknown) => (e instanceof ContractError ? e.code : 'failed')

const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * A WebSocket server for Revive's contract, for development only
 * (REVIVE_DEV_WS=1). Calls the same handlers as IPC, through the same
 * dispatcher. Localhost only, a random token per start, and no browser page
 * from another origin can connect. Pairing and device tokens come in M7.
 */
export async function startDevWsServer(opts: {
  handlers: Handlers
  streams: ServerStreams
  hub: SessionHub
  /** The current folder and its project ids, for pictures. */
  assets: () => Promise<{ folder: string; projectIds: Set<string> } | null>
  port?: number
  token?: string
  checkOutputs: boolean
  log?: (line: string) => void
}): Promise<DevWsServer> {
  const token = opts.token ?? randomBytes(32).toString('base64url')
  const conns = new Set<Conn>()
  let port = 0

  const hostOk = (req: IncomingMessage) => {
    const host = req.headers.host ?? ''
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`
  }
  // Browsers always send Origin. Only this server's own pages may connect (a future web client);
  // clients that aren't browsers send none and still need the token.
  const originOk = (req: IncomingMessage) => {
    const origin = req.headers.origin
    return origin === undefined || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`
  }
  const tokenFrom = (req: IncomingMessage): string | null => {
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ')) return auth.slice(7)
    return new URL(req.url ?? '/', 'http://x').searchParams.get('token')
  }

  const http: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const deny = (status: number) => res.writeHead(status, { 'content-type': 'text/plain' }).end(status === 401 ? 'Unauthorized' : 'Not found')
      if (!hostOk(req) || !originOk(req)) return deny(403)
      const given = tokenFrom(req)
      if (!given || !sameToken(given, token)) return deny(401)
      const url = new URL(req.url ?? '/', 'http://x')
      const ctx = req.method === 'GET' ? await opts.assets() : null
      const file = ctx ? resolveAssetRequest(ctx.folder, url.pathname, ctx.projectIds) : null
      if (!file) return deny(404)
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-cache', 'cross-origin-resource-policy': 'same-origin' }).end(await readFile(file))
    })().catch(() => res.writeHead(500).end())
  })

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    handleProtocols: (protocols) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false)
  })

  http.on('upgrade', (req, socket, head) => {
    const reject = (status: number) => {
      socket.write(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`)
      socket.destroy()
    }
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname !== '/ws' || !hostOk(req) || !originOk(req)) return reject(403)
    const offered = String(req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((p) => p.trim())
    const given = offered.find((p) => p.startsWith(WS_TOKEN_PREFIX))?.slice(WS_TOKEN_PREFIX.length)
    if (!given || !sameToken(given, token) || !offered.includes(WS_PROTOCOL)) return reject(401)
    wss.handleUpgrade(req, socket, head, (ws) => accept(ws))
  })

  const send = (c: Conn, msg: ServerMessage) => {
    if (c.ws.readyState !== c.ws.OPEN) return
    if (c.ws.bufferedAmount > STATE_LIMIT) return c.ws.terminate()
    c.ws.send(JSON.stringify(msg))
  }

  /** Sends what a client is missing from the session buffer, in one frame. Never waits. */
  const catchUp = (c: Conn, id: SessionId, w: Watch) => {
    const out = opts.hub.output(id, w.next)
    if (out.nextOffset <= w.next && !out.truncated) return
    if (out.data.length > 0 || out.truncated) c.ws.send(encodeOutputFrame({ s: id, o: out.fromOffset, tr: out.truncated || out.fromOffset > w.next }, out.data))
    w.next = out.nextOffset
  }

  const accept = (ws: WebSocket) => {
    const c: Conn = { ws, watches: new Map() }
    conns.add(c)
    ws.on('close', () => conns.delete(c))
    ws.on('error', () => ws.terminate())
    ws.on('message', (data, isBinary) => {
      if (isBinary) return
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(data)) as ClientMessage
      } catch {
        return
      }
      if (msg.t === 'call') {
        void dispatch(opts.handlers, msg.m, msg.i, { transport: 'ws' }, opts.checkOutputs).then(
          (v) => send(c, { t: 'ret', id: msg.id, ok: true, v }),
          (e: unknown) => send(c, { t: 'ret', id: msg.id, ok: false, e: { code: errorCode(e), message: String((e as Error)?.message ?? e) } })
        )
      } else if (msg.t === 'watch') {
        const ref = parseSessionId(String(msg.s))
        if (!ref || typeof msg.o !== 'number' || msg.o < 0) return
        const id = toSessionId(ref)
        const w = { next: Math.floor(msg.o) }
        c.watches.set(id, w)
        catchUp(c, id, w)
      } else if (msg.t === 'unwatch') {
        c.watches.delete(msg.s as SessionId)
      } else if (msg.t === 'input') {
        handleClientStream(opts.hub, 'session:input', { sessionId: msg.s, data: msg.d })
      } else if (msg.t === 'resize') {
        handleClientStream(opts.hub, 'session:resize', { sessionId: msg.s, cols: msg.c, rows: msg.r })
      }
    })
  }

  // Every server stream to every client; session output only to clients watching that session.
  const off = opts.streams.subscribe((stream, payload) => {
    if (stream !== 'session:output') {
      if ((SERVER_STREAMS as readonly string[]).includes(stream)) for (const c of conns) send(c, { t: 'ev', s: stream, p: payload })
      return
    }
    const chunk = payload as { sessionId: string; offset: number; data: string }
    const id = chunk.sessionId as SessionId
    for (const c of conns) {
      const w = c.watches.get(id)
      if (!w || c.ws.readyState !== c.ws.OPEN) continue
      // A slow client never holds anyone up: it simply falls behind, and catches up from the buffer.
      if (c.ws.bufferedAmount > OUTPUT_HIGH_WATER) continue
      if (chunk.offset === w.next) {
        c.ws.send(encodeOutputFrame({ s: id, o: chunk.offset }, chunk.data))
        w.next = chunk.offset + Buffer.byteLength(chunk.data)
      } else if (chunk.offset > w.next) {
        catchUp(c, id, w)
      }
    }
  })

  // Clients that fell behind catch up once their socket has room again.
  const timer = setInterval(() => {
    for (const c of conns) {
      if (c.ws.readyState !== c.ws.OPEN || c.ws.bufferedAmount > OUTPUT_HIGH_WATER) continue
      for (const [id, w] of c.watches) catchUp(c, id, w)
    }
  }, CATCH_UP_EVERY_MS)
  timer.unref()

  await new Promise<void>((resolve) => http.listen(opts.port ?? 0, '127.0.0.1', resolve))
  port = (http.address() as AddressInfo).port
  const url = `ws://127.0.0.1:${port}/ws`
  const httpUrl = `http://127.0.0.1:${port}`

  return {
    url,
    httpUrl,
    token,
    port,
    dropAll: () => {
      for (const c of conns) c.ws.terminate()
    },
    close: async () => {
      clearInterval(timer)
      off()
      for (const c of conns) c.ws.terminate()
      await new Promise<void>((r) => wss.close(() => r()))
      await new Promise<void>((r) => http.close(() => r()))
    }
  }
}
