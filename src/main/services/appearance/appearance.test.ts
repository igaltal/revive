import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE } from '@shared/appearance'
import { LOCAL_DEVICE } from '@shared/host'
import { WsTransport, RemoteError } from '@shared/ws-transport'
import { createHandlers, type Core } from '../../contract/handlers'
import { makeCore, platform, startTestHost } from '../../contract/testing'
import { AppearanceStore } from './appearance-store'

/** The smallest valid JPEG header and end marker around some bytes. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])])

let core: Core
let host: Awaited<ReturnType<typeof startTestHost>>
const local = { transport: 'ipc' as const, device: LOCAL_DEVICE }
const clients: WsTransport[] = []

async function device(name: string) {
  const { token } = host.devices.add(name)
  const t = new WsTransport({ url: host.server.url, httpUrl: host.server.httpUrl, token, retry: { minMs: 20, maxMs: 200 } })
  await t.connect()
  clients.push(t)
  return { t, token }
}

beforeAll(async () => {
  ;({ core } = makeCore())
  host = await startTestHost(core)
})
afterAll(async () => {
  for (const c of clients) c.close()
  await host.server.close()
})

describe('each device has its own look', () => {
  it('changing the phone does not change the MacBook, or this computer', async () => {
    const phone = await device('Noa phone')
    const mac = await device('MacBook')
    const direct = createHandlers(core, platform)

    const set = await phone.t.invoke('appearance:set', { theme: 'paper', scene: 'night', glass: 'strong', accent: 'pink', clock: { hours: '12', seconds: true, date: false } })
    expect(set).toMatchObject({ theme: 'paper', scene: 'night', glass: 'strong', accent: 'pink' })
    await mac.t.invoke('appearance:set', { accent: '#12ab34', density: 'large' })

    // Each device reads back exactly its own.
    expect(await phone.t.invoke('appearance:get')).toMatchObject({ theme: 'paper', scene: 'night', accent: 'pink', density: 'comfortable' })
    expect(await mac.t.invoke('appearance:get')).toMatchObject({ theme: null, scene: 'auto', glass: 'normal', accent: '#12ab34', density: 'large' })
    expect(await direct['appearance:get'](undefined, local)).toEqual(DEFAULT_APPEARANCE)
  })

  it('a device only ever sees its own photos', async () => {
    const phone = await device('Photo phone')
    const mac = await device('Photo Mac')
    const photo = await phone.t.invoke('photos:add', { jpegBase64: JPEG.toString('base64'), worst: '#FFEEDD' })
    expect(photo.worst).toBe('#ffeedd')
    await phone.t.invoke('appearance:set', { background: photo.id })
    expect((await phone.t.invoke('appearance:get')).background).toBe(photo.id)

    const get = (token: string) => fetch(`${host.server.httpUrl}/photos/${photo.id}.jpg`, { headers: { authorization: `Bearer ${token}` } })
    const mine = await get(phone.token)
    expect(mine.status).toBe(200)
    expect(mine.headers.get('content-type')).toBe('image/jpeg')
    expect(Buffer.from(await mine.arrayBuffer()).equals(JPEG)).toBe(true)
    expect((await get(mac.token)).status).toBe(404)
    expect((await fetch(`${host.server.httpUrl}/photos/${photo.id}.jpg`)).status).toBe(401)

    // Another device can't make someone else's photo its background.
    const macLook = await mac.t.invoke('appearance:set', { background: photo.id })
    expect(macLook.background).toBeNull()

    // Removing it clears the background too.
    const after = await phone.t.invoke('photos:remove', { id: photo.id })
    expect(after.photos).toEqual([])
    expect(after.background).toBeNull()
    expect((await get(phone.token)).status).toBe(404)
  })

  it('refuses anything that is not a JPEG, and never writes the picture into the action log', async () => {
    const phone = await device('Careful phone')
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    await expect(phone.t.invoke('photos:add', { jpegBase64: png.toString('base64'), worst: '#ffffff' })).rejects.toBeInstanceOf(RemoteError)
    await phone.t.invoke('photos:add', { jpegBase64: JPEG.toString('base64'), worst: '#ffffff' })
    const log = readFileSync(join(host.dir, 'action-log.jsonl'), 'utf8')
    expect(log).toContain('"method":"photos:add"')
    expect(log).not.toContain(JPEG.toString('base64').slice(0, 24))
  })
})

describe('the store', () => {
  it('keeps each device apart across restarts, and forgets a removed device with its photos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'revive-look-'))
    const a = new AppearanceStore(dir)
    a.set('phone', { scene: 'dawn' })
    const p = a.addPhoto('phone', JPEG, '#ffffff')
    a.set('mac', { scene: 'day' })
    const b = new AppearanceStore(dir)
    expect(b.get('phone').scene).toBe('dawn')
    expect(b.get('mac').scene).toBe('day')
    expect(b.get('someone-else')).toEqual(DEFAULT_APPEARANCE)
    expect(b.photoFile('phone', p.id)).not.toBe(b.photoFile('mac', p.id))
    b.forget('phone')
    expect(b.get('phone')).toEqual(DEFAULT_APPEARANCE)
    expect(() => readFileSync(a.photoFile('phone', p.id)!)).toThrow()
    expect(b.get('mac').scene).toBe('day')
  })

  it('rejects a photo id that could escape the photo folder', () => {
    const s = new AppearanceStore(mkdtempSync(join(tmpdir(), 'revive-look-')))
    expect(s.photoFile('phone', '../../settings')).toBeNull()
    expect(s.photoFile('phone', 'abc')).toBeNull()
  })
})
