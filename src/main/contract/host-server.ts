import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, extname, join, sep } from 'node:path'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { SERVER_STREAMS } from '@shared/contract-names'
import { parseSessionId, sessionId as toSessionId, type SessionId } from '@shared/runtime'
import { CLOSE_REVOKED, encodeOutputFrame, WS_PROTOCOL, WS_TOKEN_PREFIX, type ClientMessage, type ServerMessage } from '@shared/ws-protocol'
import type { SessionHub } from '../services/sessions/session-hub'
import { resolveAssetRequest } from '../services/shots/shots'
import { parsePhotoPath } from '@shared/appearance'
import type { DeviceRegistry } from '../services/host/devices'
import type { Pairing } from '../services/host/pairing'
import { ContractError, dispatch, handleClientStream, hubSink, type CallContext, type Handlers } from './dispatch'
import type { ServerStreams } from './streams'

/** Above this much unsent data, session output waits and is caught up from the session buffer. */
const OUTPUT_HIGH_WATER = 512 * 1024
/** A client this far behind on state events is disconnected; it resumes with runtime:since. */
const STATE_LIMIT = 16 * 1024 * 1024
const CATCH_UP_EVERY_MS = 50
/** A connection that hasn't answered a ping in this long is gone (a sleeping laptop, a dropped network). */
const HEARTBEAT_MS = 15_000
/** Streams that belong to this computer's own window, never sent to remote devices. */
const LOCAL_STREAMS = new Set(['host:status', 'client:status', 'prereq:task', 'update:status'])

export interface HostServer {
  /** ws://127.0.0.1:<port>/ws */
  url: string
  httpUrl: string
  port: number
  /** Closes every live connection of a device (after a revoke), right away. */
  disconnectDevice(deviceId: string): number
  /** Devices with a live connection now. */
  onlineDevices(): Set<string>
  /** Drops every connection (clients reconnect and resume). For tests. */
  dropAll(): void
  close(): Promise<void>
}

interface Watch {
  /** The next byte this client needs. */
  next: number
  /** The buffer lifetime `next` belongs to. */
  epoch: string | undefined
}

interface Conn {
  ws: WebSocket
  ctx: CallContext
  watches: Map<SessionId, Watch>
  /** Streams every session's output (the desktop client). */
  all: boolean
  alive: boolean
}

/** The browser's device cookie. HttpOnly, so no page script can read it. */
export const COOKIE = 'revive_device'
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60

function cookieToken(req: IncomingMessage): string | null {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === COOKIE) return v.join('=') || null
  }
  return null
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
}

/** The page may load only its own files and talk only to this Host. */
const WEB_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

/** Serves a file of the web app, or its page for app routes. False if the path isn't the web app's. */
async function serveWeb(root: string, pathname: string, res: ServerResponse): Promise<boolean> {
  let rel: string
  try {
    rel = decodeURIComponent(pathname)
  } catch {
    return false
  }
  const parts = rel.split('/').filter(Boolean)
  if (parts.some((p) => p === '..' || p.startsWith('.') || p.includes('\\') || p.includes('\0'))) return false
  let file = parts.length ? join(root, ...parts) : join(root, 'web.html')
  if (!existsSync(file) || !statSync(file).isFile()) {
    // App routes (no extension) get the page; anything else isn't the web app's.
    if (extname(rel)) return false
    file = join(root, 'web.html')
  }
  const real = realpathSync(file)
  if (!real.startsWith(realpathSync(root) + sep)) return false
  const ext = extname(real)
  const immutable = parts[0] === 'assets'
  res.writeHead(200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    // Hashed assets never change; the page, the manifest and the service worker must always be fresh.
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'content-security-policy': WEB_CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(basename(real) === 'sw.js' ? { 'service-worker-allowed': '/' } : {})
  })
  res.end(await readFile(real))
  return true
}

const errorCode = (e: unknown) => (e instanceof ContractError ? e.code : 'failed')

async function readJson(req: IncomingMessage, limit = 4096): Promise<unknown> {
  let body = ''
  for await (const chunk of req) {
    body += String(chunk)
    if (body.length > limit) throw new Error('too large')
  }
  return JSON.parse(body)
}

/**
 * Revive's Host server: the contract over a WebSocket, for paired devices.
 * Listens on 127.0.0.1 only; other devices reach it through `tailscale serve`.
 * Each device has its own token (the Host keeps only its hash), browser pages
 * from other origins are refused, and pairing needs a code shown on the Host
 * and the user's approval there.
 */
export async function startHostServer(opts: {
  handlers: Handlers
  streams: ServerStreams
  hub: SessionHub
  devices: DeviceRegistry
  pairing: Pairing
  hostName: string
  /** The current folder and its project ids, for pictures. */
  assets: () => Promise<{ folder: string; projectIds: Set<string> } | null>
  /** Public names this Host is reached by (the tailnet name from `tailscale serve`). */
  publicHosts?: () => string[]
  port?: number
  checkOutputs: boolean
  onDevicesChanged?: () => void
  /** The built web app (out/web), served to browsers and phones. */
  webRoot?: string
  /** A device's own photo (background, screensaver), or null when it isn't that device's. */
  photo?: (deviceId: string, photoId: string) => string | null
}): Promise<HostServer> {
  const conns = new Set<Conn>()
  const sink = hubSink(opts.hub)
  let port = 0

  const hosts = () => [`127.0.0.1:${port}`, `localhost:${port}`, ...(opts.publicHosts?.() ?? []).flatMap((h) => [h, `${h}:443`])]
  const hostOk = (req: IncomingMessage) => hosts().includes(req.headers.host ?? '')
  // Browsers always send Origin. Only pages this Host serves (its web app, on its own origins) may
  // connect; programs that aren't browsers (the desktop client) send none, and still need a device token.
  const originOk = (req: IncomingMessage) => {
    const origin = req.headers.origin
    if (origin === undefined) return true
    return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}` || (opts.publicHosts?.() ?? []).some((h) => origin === `https://${h}`)
  }
  /** A device token: the desktop client's header, or a browser's HttpOnly cookie. Never from a URL. */
  const tokenFrom = (req: IncomingMessage): string | null => {
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ')) return auth.slice(7)
    return cookieToken(req)
  }
  const deviceFor = (token: string | null) => (token ? opts.devices.verify(token) : null)
  /** The browser's device token: HttpOnly (no page script sees it), Secure, sent only to this origin. */
  const secureCookie = (token: string) => `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE}`
  const clearCookie = `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`

  const http: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body))
    void (async () => {
      if (!hostOk(req) || !originOk(req)) return json(403, { error: 'forbidden' })
      const url = new URL(req.url ?? '/', 'http://x')

      // Pairing needs no token: it needs the code on the Host's screen, and then the user's approval there.
      if (url.pathname === '/pair' && req.method === 'POST') {
        let body: { code?: unknown; deviceName?: unknown }
        try {
          body = (await readJson(req)) as typeof body
        } catch {
          return json(400, { error: 'bad_request' })
        }
        // A request with an Origin comes from a web page: its token will be a cookie, never shown to it.
        const r = opts.pairing.submit(String(body.code ?? ''), String(body.deviceName ?? ''), { browser: req.headers.origin !== undefined })
        return r.ok ? json(202, { requestId: r.requestId, hostName: opts.hostName }) : json(r.reason === 'locked' ? 429 : 403, { error: r.reason })
      }
      const poll = /^\/pair\/([0-9a-f-]{36})$/.exec(url.pathname)
      if (poll && req.method === 'GET') {
        const r = opts.pairing.poll(poll[1]!)
        if (r.state !== 'approved') return json(200, r)
        opts.onDevicesChanged?.()
        if (r.browser) return json(200, { state: r.state, deviceId: r.deviceId, hostName: opts.hostName }, { 'set-cookie': secureCookie(r.token) })
        return json(200, { state: r.state, deviceId: r.deviceId, token: r.token, hostName: opts.hostName })
      }

      // The web app itself: public files (no data in them), path-locked.
      if (opts.webRoot && req.method === 'GET' && !url.pathname.startsWith('/shots/') && !url.pathname.startsWith('/photos/') && url.pathname !== '/whoami') {
        const served = await serveWeb(opts.webRoot, url.pathname, res)
        if (served) return
      }

      const token = tokenFrom(req)
      const device = deviceFor(token)
      if (url.pathname === '/logout' && req.method === 'POST') {
        // Signing out a browser ends its device: the cookie can't be used again.
        if (device) {
          opts.devices.revoke(device.id)
          opts.onDevicesChanged?.()
        }
        return json(200, { ok: true }, { 'set-cookie': clearCookie })
      }
      // A dead cookie (revoked) is removed from the browser along the way.
      if (!device) return json(401, { error: 'unauthorized' }, cookieToken(req) ? { 'set-cookie': clearCookie } : {})
      if (url.pathname === '/whoami') return json(200, { deviceId: device.id, deviceName: device.name, hostName: opts.hostName })
      // Photos: only the device that added one can fetch it.
      const photoId = req.method === 'GET' ? parsePhotoPath(url.pathname) : null
      if (photoId) {
        const file = opts.photo?.(device.id, photoId) ?? null
        if (!file) return json(404, { error: 'not_found' })
        return res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400, immutable', 'cross-origin-resource-policy': 'same-origin' }).end(await readFile(file))
      }
      const ctx = req.method === 'GET' ? await opts.assets() : null
      const file = ctx ? resolveAssetRequest(ctx.folder, url.pathname, ctx.projectIds) : null
      if (!file) return json(404, { error: 'not_found' })
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'cross-origin-resource-policy': 'same-origin' }).end(await readFile(file))
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end()
    })
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
    // The desktop client sends its token as a subprotocol; a browser page sends its HttpOnly cookie,
    // and only from this Host's own origin (checked above).
    const device = deviceFor(offered.find((p) => p.startsWith(WS_TOKEN_PREFIX))?.slice(WS_TOKEN_PREFIX.length) ?? (req.headers.origin ? cookieToken(req) : null))
    if (!device || !offered.includes(WS_PROTOCOL)) return reject(401)
    wss.handleUpgrade(req, socket, head, (ws) => accept(ws, { transport: 'ws', device: { id: device.id, name: device.name } }))
  })

  const send = (c: Conn, msg: ServerMessage) => {
    if (c.ws.readyState !== c.ws.OPEN) return
    if (c.ws.bufferedAmount > STATE_LIMIT) return c.ws.terminate()
    c.ws.send(JSON.stringify(msg))
  }

  /** Sends what a client is missing from the session buffer, in one frame. Never waits. */
  const catchUp = (c: Conn, id: SessionId, w: Watch) => {
    const out = opts.hub.output(id, w.next, w.epoch)
    const restarted = w.epoch !== undefined && w.epoch !== out.epoch
    if (!restarted && out.nextOffset <= w.next && !out.truncated) return
    if (out.data.length > 0 || out.truncated || restarted) c.ws.send(encodeOutputFrame({ s: id, o: out.fromOffset, e: out.epoch, tr: out.truncated || (!restarted && out.fromOffset > w.next) }, out.data))
    w.next = out.nextOffset
    w.epoch = out.epoch
  }

  const accept = (ws: WebSocket, ctx: CallContext) => {
    const c: Conn = { ws, ctx, watches: new Map(), all: false, alive: true }
    conns.add(c)
    opts.devices.touch(ctx.device.id)
    opts.onDevicesChanged?.()
    ws.on('pong', () => (c.alive = true))
    ws.on('close', () => {
      conns.delete(c)
      opts.devices.touch(ctx.device.id)
      opts.onDevicesChanged?.()
    })
    ws.on('error', () => ws.terminate())
    ws.on('message', (data, isBinary) => {
      c.alive = true
      if (isBinary) return
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(data)) as ClientMessage
      } catch {
        return
      }
      if (msg.t === 'call') {
        void dispatch(opts.handlers, msg.m, msg.i, ctx, opts.checkOutputs).then(
          (v) => send(c, { t: 'ret', id: msg.id, ok: true, v }),
          (e: unknown) => send(c, { t: 'ret', id: msg.id, ok: false, e: { code: errorCode(e), message: String((e as Error)?.message ?? e) } })
        )
      } else if (msg.t === 'watch') {
        const ref = parseSessionId(String(msg.s))
        if (!ref || typeof msg.o !== 'number' || msg.o < 0) return
        const id = toSessionId(ref)
        const w: Watch = { next: Math.floor(msg.o), epoch: typeof msg.e === 'string' ? msg.e : undefined }
        c.watches.set(id, w)
        catchUp(c, id, w)
      } else if (msg.t === 'unwatch') {
        c.watches.delete(msg.s as SessionId)
      } else if (msg.t === 'watchAll') {
        c.all = true
      } else if (msg.t === 'ping') {
        send(c, { t: 'pong' })
      } else if (msg.t === 'input') {
        handleClientStream(sink, 'session:input', { sessionId: msg.s, data: msg.d })
      } else if (msg.t === 'resize') {
        handleClientStream(sink, 'session:resize', { sessionId: msg.s, cols: msg.c, rows: msg.r })
      }
    })
  }

  // Core streams to every device; session output only where it's watched (or to watch-all clients).
  const off = opts.streams.subscribe((stream, payload) => {
    if (stream !== 'session:output') {
      if ((SERVER_STREAMS as readonly string[]).includes(stream) && !LOCAL_STREAMS.has(stream)) for (const c of conns) send(c, { t: 'ev', s: stream, p: payload })
      return
    }
    const chunk = payload as { sessionId: string; offset: number; epoch: string; data: string }
    const id = chunk.sessionId as SessionId
    for (const c of conns) {
      let w = c.watches.get(id)
      if (!w && c.all) c.watches.set(id, (w = { next: chunk.offset, epoch: chunk.epoch }))
      if (!w || c.ws.readyState !== c.ws.OPEN) continue
      // A slow client never holds anyone up: it falls behind, and catches up from the buffer.
      if (c.ws.bufferedAmount > OUTPUT_HIGH_WATER) continue
      if (chunk.offset === w.next && (w.epoch === undefined || w.epoch === chunk.epoch)) {
        w.epoch = chunk.epoch
        c.ws.send(encodeOutputFrame({ s: id, o: chunk.offset, e: chunk.epoch }, chunk.data))
        w.next = chunk.offset + Buffer.byteLength(chunk.data)
      } else if (chunk.offset > w.next || w.epoch !== chunk.epoch) {
        catchUp(c, id, w)
      }
    }
  })

  const catchUpTimer = setInterval(() => {
    for (const c of conns) {
      if (c.ws.readyState !== c.ws.OPEN || c.ws.bufferedAmount > OUTPUT_HIGH_WATER) continue
      for (const [id, w] of c.watches) catchUp(c, id, w)
    }
  }, CATCH_UP_EVERY_MS)
  catchUpTimer.unref()

  const heartbeat = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) {
        c.ws.terminate()
        continue
      }
      c.alive = false
      c.ws.ping()
    }
  }, HEARTBEAT_MS)
  heartbeat.unref()

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    // Never 0.0.0.0: other devices come through `tailscale serve`, which connects locally.
    http.listen(opts.port ?? 0, '127.0.0.1', () => {
      http.off('error', reject)
      resolve()
    })
  })
  port = (http.address() as AddressInfo).port

  return {
    url: `ws://127.0.0.1:${port}/ws`,
    httpUrl: `http://127.0.0.1:${port}`,
    port,
    disconnectDevice: (deviceId) => {
      let n = 0
      for (const c of conns) {
        if (c.ctx.device.id !== deviceId) continue
        c.ws.close(CLOSE_REVOKED, 'revoked')
        // Don't wait for a polite close: it's gone now.
        setTimeout(() => c.ws.terminate(), 200).unref()
        conns.delete(c)
        n += 1
      }
      return n
    },
    onlineDevices: () => new Set([...conns].map((c) => c.ctx.device.id)),
    dropAll: () => {
      for (const c of conns) c.ws.terminate()
    },
    close: async () => {
      clearInterval(catchUpTimer)
      clearInterval(heartbeat)
      off()
      for (const c of conns) c.ws.terminate()
      await new Promise<void>((r) => wss.close(() => r()))
      await new Promise<void>((r) => http.close(() => r()))
    }
  }
}
