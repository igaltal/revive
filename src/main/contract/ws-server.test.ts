import { connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { StateEvent } from '@shared/runtime'
import { decodeOutputFrame, WS_PROTOCOL, WS_TOKEN_PREFIX } from '@shared/ws-protocol'
import { WsTransport, RemoteError } from '@shared/ws-transport'
import { saveShot } from '../services/shots/shots'
import { createHandlers, type Core } from './handlers'
import { makeCore, platform, until } from './testing'
import { startDevWsServer, type DevWsServer } from './ws-server'

let core: Core
let folder: string
let server: DevWsServer

beforeAll(async () => {
  ;({ core, folder } = makeCore())
  server = await startDevWsServer({ handlers: createHandlers(core, platform), streams: core.streams, hub: core.hub, assets: () => core.workspace.projectIds(), checkOutputs: true })
  const direct = createHandlers(core, platform)
  await direct['folder:choose']({ path: folder }, { transport: 'ipc' })
  await new Promise<void>((resolve) => {
    const off = core.streams.subscribe((s) => s === 'scan:done' && (off(), resolve()))
    void direct['scan:start'](undefined, { transport: 'ipc' })
  })
})
afterAll(async () => {
  await core.runner.stopAll()
  await server.close()
})

/** Opens a raw connection with chosen headers; resolves 'open' or the HTTP status it was refused with. */
function attempt(opts: { token?: string | null; origin?: string; host?: string; protocols?: string[] } = {}): Promise<'open' | number> {
  const token = opts.token === undefined ? server.token : opts.token
  const protocols = opts.protocols ?? [WS_PROTOCOL, ...(token ? [`${WS_TOKEN_PREFIX}${token}`] : [])]
  return new Promise((resolve) => {
    const ws = new WebSocket(server.url, protocols, { origin: opts.origin, headers: opts.host ? { host: opts.host } : undefined })
    ws.on('open', () => {
      ws.close()
      resolve('open')
    })
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
    ws.on('error', () => resolve(0))
  })
}

describe('dev WebSocket server: who may connect', () => {
  it('listens on 127.0.0.1 only', async () => {
    expect(server.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/ws$/)
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address
    if (lan) {
      const reachable = await new Promise<boolean>((resolve) => {
        const s = connect({ host: lan, port: server.port })
        s.once('connect', () => (s.destroy(), resolve(true)))
        s.once('error', () => resolve(false))
      })
      expect(reachable).toBe(false)
    }
  })

  it('needs the token printed at startup', async () => {
    expect(await attempt()).toBe('open')
    expect(await attempt({ token: null })).toBe(401)
    expect(await attempt({ token: 'x'.repeat(server.token.length) })).toBe(401)
    expect(await attempt({ protocols: [`${WS_TOKEN_PREFIX}${server.token}`] })).toBe(401)
  })

  it("refuses browser pages from other origins, even with the token, and DNS-rebinding hosts", async () => {
    expect(await attempt({ origin: 'https://evil.example' })).toBe(403)
    expect(await attempt({ origin: 'http://localhost:5173' })).toBe(403)
    expect(await attempt({ origin: 'null' })).toBe(403)
    expect(await attempt({ origin: `http://127.0.0.1:${server.port}` })).toBe('open')
    expect(await attempt({ host: `evil.example:${server.port}` })).toBe(403)
  })

  it('serves pictures over HTTP, with the token, from .revive/shots only', async () => {
    const path = await saveShot(folder, 'bakery-site', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const url = `${server.httpUrl}${path}`
    expect((await fetch(url)).status).toBe(401)
    const ok = await fetch(`${url}&token=${server.token}`)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect((await fetch(url, { headers: { authorization: `Bearer ${server.token}` } })).status).toBe(200)
    expect((await fetch(`${server.httpUrl}/shots/nope.png?token=${server.token}`)).status).toBe(404)
    expect((await fetch(`${server.httpUrl}/shots/..%2Fmanifest.png?token=${server.token}`)).status).toBe(404)
    expect((await fetch(`${url}&token=${server.token}`, { headers: { origin: 'https://evil.example' } })).status).toBe(403)

    const client = new WsTransport({ url: server.url, httpUrl: server.httpUrl, token: server.token })
    await client.connect()
    expect((await fetch(client.assetUrl(path!))).status).toBe(200)
    client.close()
  })

  it('refuses what only makes sense on the computer running Revive', async () => {
    const client = new WsTransport({ url: server.url, httpUrl: server.httpUrl, token: server.token })
    await client.connect()
    await expect(client.invoke('folder:pick')).rejects.toBeInstanceOf(RemoteError)
    await expect(client.invoke('preview:show', { projectId: 'a', bounds: { x: 0, y: 0, width: 1, height: 1 }, device: 'desktop' })).rejects.toMatchObject({ code: 'not_available' })
    await expect(client.invoke('prereq:installClaude')).rejects.toMatchObject({ code: 'not_available' })
    expect(client.capabilities()).toMatchObject({ nativePreview: false, folderPicker: false, openInBrowser: false })
    client.close()
  })
})

describe('dev WebSocket server: backpressure', () => {
  it('a client that stops reading never slows the dev server or other clients, and later catches up with the gap marked', async () => {
    // A client that stops reading its socket right after asking for the output.
    const slowFrames: Array<{ o: number; tr?: boolean; len: number }> = []
    const slow = new WebSocket(server.url, [WS_PROTOCOL, `${WS_TOKEN_PREFIX}${server.token}`])
    await new Promise((r) => slow.once('open', r))
    slow.on('message', (data, isBinary) => {
      if (!isBinary) return
      const { header, data: text } = decodeOutputFrame(new Uint8Array(data as Buffer))
      slowFrames.push({ o: header.o, tr: header.tr, len: Buffer.byteLength(text) })
    })
    slow.send(JSON.stringify({ t: 'watch', s: 'flood:run', o: 0 }))
    await new Promise((r) => setTimeout(r, 50))
    const socket = (slow as unknown as { _socket: { pause(): void; resume(): void } })._socket
    socket.pause()

    // A normal client alongside it.
    const fast = new WsTransport({ url: server.url, httpUrl: server.httpUrl, token: server.token })
    await fast.connect()
    const statuses: string[] = []
    let fastText = ''
    fast.subscribe('runtime:event', (e: StateEvent) => e.type === 'status.changed' && e.state.projectId === 'flood' && statuses.push(e.state.status))
    fast.subscribe('session:output', (c) => (fastText = (fastText + c.data).slice(-4096)), { sessionId: 'flood:run', fromOffset: 0 })

    const t0 = Date.now()
    await fast.invoke('runner:start', { projectId: 'flood' })
    // About 4 MB of output: the dev server and the other client are never held up by the stalled one.
    await until('running', () => statuses.includes('running'), 30_000)
    const tookMs = Date.now() - t0
    await until('fast client has the tail', () => /Local: http:\/\/localhost:\d+\//.test(fastText))
    expect(fastText).toContain('compiling module 70000 ')
    expect(slowFrames.reduce((n, f) => n + f.len, 0)).toBeLessThan(4 * 1024 * 1024)

    // The stalled client reads again: it gets the tail, with the dropped part marked.
    socket.resume()
    const end = core.hub.output('flood:run', 0).nextOffset
    await until('slow client caught up', () => slowFrames.some((f) => f.o + f.len === end))
    expect(slowFrames.some((f) => f.tr === true)).toBe(true)
    slow.close()
    fast.close()
    await core.runner.stop('flood')
    expect(tookMs).toBeLessThan(20_000)
  }, 60_000)
})
