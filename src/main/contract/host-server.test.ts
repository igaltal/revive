import { connect } from 'node:net'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { StateEvent } from '@shared/runtime'
import { decodeOutputFrame, WS_PROTOCOL, WS_TOKEN_PREFIX } from '@shared/ws-protocol'
import { WsTransport, RemoteError } from '@shared/ws-transport'
import type { ConnectionState } from '@shared/transport'
import { LOCAL_DEVICE } from '@shared/host'
import { saveShot } from '../services/shots/shots'
import { ClientService } from '../services/client/client-service'
import type { SecretStore } from '../extensions/secret-store'
import { createHandlers, type Core } from './handlers'
import { makeCore, platform, startTestHost, until } from './testing'
import type { HostServer } from './host-server'

let core: Core
let folder: string
let host: Awaited<ReturnType<typeof startTestHost>>
let server: HostServer

const local = { transport: 'ipc' as const, device: LOCAL_DEVICE }

beforeAll(async () => {
  ;({ core, folder } = makeCore())
  host = await startTestHost(core, { publicHosts: ['studio-mini.tail1234.ts.net'] })
  server = host.server
  const direct = createHandlers(core, platform)
  await direct['folder:choose']({ path: folder }, local)
  await new Promise<void>((resolve) => {
    const off = core.streams.subscribe((s) => s === 'scan:done' && (off(), resolve()))
    void direct['scan:start'](undefined, local)
  })
})
afterAll(async () => {
  await core.runner.stopAll()
  await server.close()
})

const client = async (token = host.token) => {
  const t = new WsTransport({ url: server.url, httpUrl: server.httpUrl, token, retry: { minMs: 20, maxMs: 200 } })
  await t.connect()
  return t
}

/** Opens a raw connection with chosen headers; resolves 'open' or the HTTP status it was refused with. */
function attempt(opts: { token?: string | null; origin?: string; host?: string; protocols?: string[] } = {}): Promise<'open' | number> {
  const token = opts.token === undefined ? host.token : opts.token
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

describe('Host server: who may connect', () => {
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

  it("needs a paired device's own token", async () => {
    expect(await attempt()).toBe('open')
    expect(await attempt({ token: null })).toBe(401)
    expect(await attempt({ token: 'x'.repeat(43) })).toBe(401)
    expect(await attempt({ protocols: [`${WS_TOKEN_PREFIX}${host.token}`] })).toBe(401)
  })

  it('still refuses browser pages from other origins, even with a valid token, and DNS-rebinding hosts', async () => {
    expect(await attempt({ origin: 'https://evil.example' })).toBe(403)
    expect(await attempt({ origin: 'null' })).toBe(403)
    expect(await attempt({ origin: 'http://localhost:5173' })).toBe(403)
    expect(await attempt({ origin: `http://127.0.0.1:${server.port}` })).toBe('open')
    expect(await attempt({ host: `evil.example:${server.port}` })).toBe(403)
    // Through `tailscale serve`: the tailnet name, and pages served from it.
    expect(await attempt({ host: 'studio-mini.tail1234.ts.net' })).toBe('open')
    expect(await attempt({ host: 'studio-mini.tail1234.ts.net', origin: 'https://studio-mini.tail1234.ts.net' })).toBe('open')
    expect(await attempt({ host: 'studio-mini.tail1234.ts.net', origin: 'https://studio-mini.evil.example' })).toBe(403)
  })

  it('serves pictures only with a device token', async () => {
    const path = await saveShot(folder, 'bakery-site', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect((await fetch(`${server.httpUrl}${path}`)).status).toBe(401)
    expect((await fetch(`${server.httpUrl}${path}`, { headers: { authorization: `Bearer ${host.token}` } })).status).toBe(200)
    expect((await fetch(`${server.httpUrl}${path}`, { headers: { authorization: `Bearer ${host.token}`, origin: 'https://evil.example' } })).status).toBe(403)
  })

  it('keeps the Host controls on the Host', async () => {
    const t = await client()
    await expect(t.invoke('host:revokeDevice', { deviceId: host.deviceId })).rejects.toMatchObject({ code: 'not_available' })
    await expect(t.invoke('host:startPairing')).rejects.toBeInstanceOf(RemoteError)
    await expect(t.invoke('client:disconnect')).rejects.toMatchObject({ code: 'not_available' })
    await expect(t.invoke('folder:pick')).rejects.toMatchObject({ code: 'not_available' })
    t.close()
  })
})

describe('pairing over the network', () => {
  it('a code, then the Host user allows it, then a token that works; nothing before approval', async () => {
    const post = (code: string) =>
      fetch(`${server.httpUrl}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, deviceName: 'Studio laptop' }) })
    const { code } = host.pairing.start()
    const wrong = await post(code === '000000' ? '000001' : '000000')
    expect(wrong.status).toBe(403)
    expect(await wrong.json()).toEqual({ error: 'bad_code' })

    const ok = await post(code)
    expect(ok.status).toBe(202)
    const { requestId, hostName } = (await ok.json()) as { requestId: string; hostName: string }
    expect(hostName).toBe('Test Host')
    expect((await (await post(code)).json()) as unknown).toEqual({ error: 'no_pairing' })

    // Waiting for the Host user: no token, no device.
    expect(await (await fetch(`${server.httpUrl}/pair/${requestId}`)).json()).toEqual({ state: 'pending' })
    expect(host.devices.active().map((d) => d.name)).not.toContain('Studio laptop')

    host.pairing.answer(requestId, true)
    const approved = (await (await fetch(`${server.httpUrl}/pair/${requestId}`)).json()) as { state: string; token: string }
    expect(approved.state).toBe('approved')
    expect(await (await fetch(`${server.httpUrl}/pair/${requestId}`)).json()).toEqual({ state: 'unknown' })
    const t = await client(approved.token)
    expect(Array.isArray(await t.invoke('runner:list'))).toBe(true)
    t.close()
  })

  it('pairing requests from browser pages of other origins are refused', async () => {
    const res = await fetch(`${server.httpUrl}/pair`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"code":"123456","deviceName":"x"}' })
    expect(res.status).toBe(403)
  })
})

describe('devices', () => {
  it('a revoked device is disconnected within one second, and its token stops working', async () => {
    const { device, token } = host.devices.add('Old laptop')
    const t = await client(token)
    const states: ConnectionState[] = []
    t.onConnection((s) => states.push(s))
    const t0 = Date.now()
    host.devices.revoke(device.id)
    expect(server.disconnectDevice(device.id)).toBe(1)
    await until('rejected', () => states.includes('rejected'), 1000)
    expect(Date.now() - t0).toBeLessThan(1000)
    await expect(t.invoke('runner:list')).rejects.toThrow()
    expect(await attempt({ token })).toBe(401)
    expect((await fetch(`${server.httpUrl}/whoami`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401)
  })

  it('two clients on the same session both see the output, and either can type into it', async () => {
    const a = await client()
    const b = await client()
    const opened = await a.invoke('sessions:open', { projectId: 'echo', kind: 'shell' })
    expect(opened).toEqual({ ok: true, sessionId: 'echo:shell', created: true })
    const sessionId = 'echo:shell'
    expect(await b.invoke('sessions:open', { projectId: 'echo', kind: 'shell' })).toEqual({ ok: true, sessionId, created: false })
    let seenA = ''
    let seenB = ''
    a.subscribe('session:output', (c) => (seenA += c.data), { sessionId, fromOffset: 0 })
    b.subscribe('session:output', (c) => (seenB += c.data), { sessionId, fromOffset: 0 })
    a.writeSession(sessionId, 'echo typed-on-A\n')
    b.writeSession(sessionId, 'echo typed-on-B\n')
    await until('both outputs on both clients', () => [seenA, seenB].every((s) => s.includes('typed-on-A') && s.includes('typed-on-B')))
    expect((await a.invoke('sessions:list')).map((s) => s.sessionId)).toContain('echo:shell')
    await b.invoke('sessions:close', { sessionId, confirm: true })
    a.close()
    b.close()
  })
})

describe('the action log', () => {
  it('records which device started a run, opened a terminal and went back to a version, and never a secret', async () => {
    const SECRET = 'planted-secret-value-7d1e9'
    writeFileSync(join(folder, 'bakery-site/.env'), `MAPS_KEY=${SECRET}\n`)
    const t = await client()
    await t.invoke('runner:start', { projectId: 'bakery-site' })
    await t.invoke('sessions:open', { projectId: 'bakery-site', kind: 'shell' })
    t.writeSession('bakery-site:shell', `export TOKEN=${SECRET}\n`)
    const v = await t.invoke('versions:save')
    await t.invoke('versions:restore', { versionId: v.id, projectId: 'bakery-site' })
    await t.invoke('settings:set', { scanModel: SECRET })
    await t.invoke('settings:set', { scanModel: 'haiku' })
    await t.invoke('runner:stop', { projectId: 'bakery-site' })
    await t.invoke('sessions:close', { sessionId: 'bakery-site:shell', confirm: true })
    t.close()

    const entries = host.log.latest(50)
    const by = (method: string) => entries.find((e) => e.method === method)
    for (const method of ['runner:start', 'sessions:open', 'versions:restore']) {
      expect(by(method), method).toMatchObject({ deviceId: host.deviceId, deviceName: 'Test laptop' })
    }
    expect(by('versions:restore')!.summary).toEqual({ versionId: v.id, projectId: 'bakery-site' })
    expect(by('sessions:open')!.summary).toEqual({ projectId: 'bakery-site', kind: 'shell' })
    expect(by('settings:set')!.summary).toEqual({ fields: 'scanModel' })
    // Reading doesn't count.
    expect(entries.some((e) => e.method === 'runner:list' || e.method === 'versions:list')).toBe(false)
    expect(readFileSync(join(host.dir, 'action-log.jsonl'), 'utf8')).not.toContain(SECRET)
  })
})

describe('a paired computer across a Host restart', () => {
  it('reconnects on its own, without pairing again, and resumes', async () => {
    // A stand-in for safeStorage: the test only checks the token is never stored as-is.
    const secrets: SecretStore = {
      isAvailable: () => true,
      encrypt: (plain) => Buffer.from(`enc:${Buffer.from(plain).toString('base64')}`),
      decrypt: (cipher) => Buffer.from(cipher.toString().slice(4), 'base64').toString()
    }
    const userData = mkdtempSync(join(tmpdir(), 'revive-client-'))
    const statuses: string[] = []
    const events: string[] = []
    const make = () =>
      new ClientService({
        userData,
        secrets,
        timing: { pollMs: 20, retryMaxMs: 200, heartbeatMs: 1000 },
        events: { stream: (s, p) => s === 'runtime:event' && events.push((p as StateEvent).type), status: (s) => statuses.push(s.state) }
      })

    const c1 = make()
    const { code } = host.pairing.start()
    expect((await c1.connect({ address: server.httpUrl, code, deviceName: 'Travel laptop' })).state).toBe('waiting')
    await until('request on the Host', () => host.pairing.pending().some((r) => r.deviceName === 'Travel laptop'))
    host.pairing.answer(host.pairing.pending().find((r) => r.deviceName === 'Travel laptop')!.id, true)
    await until('open', () => c1.status().state === 'open')
    expect(readFileSync(join(userData, 'client.json'), 'utf8')).not.toMatch(/"token": "[A-Za-z0-9_-]{43}"/)
    c1.close()

    // The Host restarts on the same port, with the same devices.
    const port = server.port
    await server.close()
    const again = await startTestHost(core, { port, dir: host.dir })
    server = again.server
    host = { ...again, token: host.token, deviceId: host.deviceId }

    const c2 = make()
    c2.resume()
    await until('reconnected without pairing', () => c2.status().state === 'open', 10_000)
    expect(await c2.invoke('runner:list', undefined)).toEqual(expect.any(Array))
    await c2.invoke('versions:save', undefined)
    await until('Host events reach the client', () => events.includes('version.saved'))

    // A drop while connected: it comes back by itself.
    server.dropAll()
    await until('reconnecting', () => statuses.at(-1) === 'reconnecting' || c2.status().state === 'reconnecting', 5000).catch(() => {})
    await until('open again', () => c2.status().state === 'open', 10_000)
    c2.close()
  }, 30_000)
})

describe('backpressure', () => {
  it('a client that stops reading never slows the dev server or other clients, and later catches up with the gap marked', async () => {
    const slowFrames: Array<{ o: number; tr?: boolean; len: number }> = []
    const slow = new WebSocket(server.url, [WS_PROTOCOL, `${WS_TOKEN_PREFIX}${host.token}`])
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

    const fast = await client()
    const statuses: string[] = []
    let fastText = ''
    fast.subscribe('runtime:event', (e: StateEvent) => e.type === 'status.changed' && e.state.projectId === 'flood' && statuses.push(e.state.status))
    fast.subscribe('session:output', (c) => (fastText = (fastText + c.data).slice(-4096)), { sessionId: 'flood:run', fromOffset: 0 })

    const t0 = Date.now()
    await fast.invoke('runner:start', { projectId: 'flood' })
    // A slow client that blocked the dev server would stall it for good; the time limit only has to
    // be generous enough for a busy machine (the whole suite runs in parallel).
    await until('running', () => statuses.includes('running'), 50_000)
    const tookMs = Date.now() - t0
    await until('fast client has the tail', () => /Local: http:\/\/localhost:\d+\//.test(fastText))
    expect(fastText).toContain('compiling module 70000 ')

    socket.resume()
    const end = core.hub.output('flood:run', 0).nextOffset
    await until('slow client caught up', () => slowFrames.some((f) => f.o + f.len === end))
    expect(slowFrames.some((f) => f.tr === true)).toBe(true)
    slow.close()
    fast.close()
    await core.runner.stop('flood')
    expect(tookMs).toBeLessThan(45_000)
  }, 90_000)
})
