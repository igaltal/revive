import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { WS_PROTOCOL } from '@shared/ws-protocol'
import { ActionLog } from '../services/host/action-log'
import { DeviceRegistry } from '../services/host/devices'
import { Pairing } from '../services/host/pairing'
import { noAppHandlers, withActionLog } from './dispatch'
import { createHandlers, type Core } from './handlers'
import { startHostServer, type HostServer } from './host-server'
import { makeCore, platform } from './testing'

let core: Core
let server: HostServer
let devices: DeviceRegistry
let pairing: Pairing
let origin: string
const TAILNET = 'studio-mini.tail1234.ts.net'

beforeAll(async () => {
  ;({ core } = makeCore())
  const dir = mkdtempSync(join(tmpdir(), 'revive-web-'))
  // A stand-in for the built web app (out/web).
  const web = join(dir, 'web')
  mkdirSync(join(web, 'assets'), { recursive: true })
  writeFileSync(join(web, 'web.html'), '<!doctype html><title>Revive</title>')
  writeFileSync(join(web, 'assets', 'app-abc123.js'), 'console.log(1)')
  writeFileSync(join(web, 'sw.js'), '// sw')
  writeFileSync(join(web, 'manifest.webmanifest'), '{}')
  writeFileSync(join(dir, 'secret.txt'), 'outside the web app')
  writeFileSync(join(web, '.env'), 'NOPE=1')
  devices = new DeviceRegistry(join(dir, 'devices.json'))
  pairing = new Pairing(devices)
  server = await startHostServer({
    handlers: { ...withActionLog(createHandlers(core, platform), new ActionLog(join(dir, 'log.jsonl'))), ...noAppHandlers() },
    streams: core.streams,
    hub: core.hub,
    devices,
    pairing,
    hostName: 'Studio Mac',
    assets: () => core.workspace.projectIds(),
    publicHosts: () => [TAILNET],
    checkOutputs: true,
    webRoot: web
  })
  origin = server.httpUrl
})
afterAll(() => server.close())

/** What a browser page on the Host's own origin sends. */
const page = { origin: () => ({ origin }) }

async function pairBrowser(name = 'iPhone'): Promise<{ cookie: string; setCookie: string; body: Record<string, unknown> }> {
  const { code } = pairing.start()
  const res = await fetch(`${origin}/pair`, { method: 'POST', headers: { 'content-type': 'application/json', ...page.origin() }, body: JSON.stringify({ code, deviceName: name }) })
  const { requestId } = (await res.json()) as { requestId: string }
  pairing.answer(requestId, true)
  const poll = await fetch(`${origin}/pair/${requestId}`, { headers: page.origin() })
  const setCookie = poll.headers.get('set-cookie') ?? ''
  return { cookie: setCookie.split(';')[0]!, setCookie, body: (await poll.json()) as Record<string, unknown> }
}

function ws(headers: Record<string, string>): Promise<'open' | number> {
  return new Promise((resolve) => {
    const s = new WebSocket(server.url, [WS_PROTOCOL], { headers })
    s.on('open', () => (s.close(), resolve('open')))
    s.on('unexpected-response', (_q, r) => resolve(r.statusCode ?? 0))
    s.on('error', () => resolve(0))
  })
}

describe('the browser client and its cookie', () => {
  it('pairing from a page puts the token only in an HttpOnly, Secure, SameSite=Strict cookie, never in the answer', async () => {
    const { setCookie, body } = await pairBrowser()
    expect(setCookie).toMatch(/^revive_device=[A-Za-z0-9_-]{43}; /)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/')
    expect(body).toEqual({ state: 'approved', deviceId: expect.any(String), hostName: 'Studio Mac' })
    expect(JSON.stringify(body)).not.toContain(setCookie.split(';')[0]!.split('=')[1]!)
  })

  it('the cookie opens the WebSocket only from the Host’s own origin', async () => {
    const { cookie } = await pairBrowser()
    expect(await ws({ cookie, origin })).toBe('open')
    expect(await ws({ cookie, origin: `https://${TAILNET}`, host: TAILNET })).toBe('open')
    expect(await ws({ cookie, origin: 'https://evil.example' })).toBe(403)
    expect(await ws({ cookie, origin: 'null' })).toBe(403)
    // No token, no cookie: nothing.
    expect(await ws({ origin })).toBe(401)
    // A cookie without an Origin (not a browser) isn't how a browser connects: refused.
    expect(await ws({ cookie })).toBe(401)
    expect((await fetch(`${origin}/whoami`, { headers: { cookie } })).status).toBe(200)
  })

  it('revoking signs the browser out, and its dead cookie is removed', async () => {
    const { cookie, body } = await pairBrowser('Old phone')
    devices.revoke(String(body['deviceId']))
    server.disconnectDevice(String(body['deviceId']))
    const res = await fetch(`${origin}/whoami`, { headers: { cookie } })
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toMatch(/^revive_device=; .*Max-Age=0/)
    expect(await ws({ cookie, origin })).toBe(401)
  })

  it('signing out from the page ends that device and clears the cookie', async () => {
    const { cookie, body } = await pairBrowser('Tablet')
    const out = await fetch(`${origin}/logout`, { method: 'POST', headers: { cookie, ...page.origin() } })
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/)
    expect(devices.get(String(body['deviceId']))?.revokedAt).toBeTruthy()
    expect((await fetch(`${origin}/whoami`, { headers: { cookie } })).status).toBe(401)
  })

  it('a foreign origin is still refused everywhere, pairing included', async () => {
    const evil = { origin: 'https://evil.example' }
    const { code } = pairing.start()
    expect((await fetch(`${origin}/pair`, { method: 'POST', headers: { 'content-type': 'application/json', ...evil }, body: JSON.stringify({ code, deviceName: 'x' }) })).status).toBe(403)
    expect((await fetch(`${origin}/`, { headers: evil })).status).toBe(403)
    expect((await fetch(`${origin}/whoami`, { headers: evil })).status).toBe(403)
    expect(await ws(evil)).toBe(403)
    pairing.cancel()
  })
})

describe('the web app, served by the Host', () => {
  it('serves the page with a strict CSP; app routes get the page; hashed assets are immutable', async () => {
    const root = await fetch(`${origin}/`)
    expect(root.status).toBe(200)
    expect(await root.text()).toContain('<title>Revive</title>')
    expect(root.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(root.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(root.headers.get('cache-control')).toBe('no-cache')
    expect(root.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await fetch(`${origin}/projects/bakery`)).status).toBe(200)
    const asset = await fetch(`${origin}/assets/app-abc123.js`)
    expect(asset.headers.get('cache-control')).toContain('immutable')
    expect((await fetch(`${origin}/sw.js`)).headers.get('cache-control')).toBe('no-cache')
    expect((await fetch(`${origin}/manifest.webmanifest`)).headers.get('content-type')).toBe('application/manifest+json')
  })

  it('never serves anything outside the web app, or hidden files', async () => {
    expect((await fetch(`${origin}/.env`)).status).not.toBe(200)
    expect((await fetch(`${origin}/..%2Fsecret.txt`)).status).not.toBe(200)
    expect((await fetch(`${origin}/assets/missing.js`)).status).not.toBe(200)
    // Pictures still need a device.
    expect((await fetch(`${origin}/shots/bakery-site.png`)).status).toBe(401)
  })
})
