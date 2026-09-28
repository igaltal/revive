import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeviceRegistry } from './devices'
import { PAIRING, Pairing } from './pairing'

function setup() {
  const file = join(mkdtempSync(join(tmpdir(), 'revive-pair-')), 'devices.json')
  const devices = new DeviceRegistry(file)
  let now = 1_000_000
  const pairing = new Pairing(devices, () => {}, () => now)
  return { devices, pairing, file, tick: (ms: number) => (now += ms) }
}
const wrongFor = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0')

describe('pairing', () => {
  it('codes are six digits and expire after five minutes', () => {
    const t = setup()
    const { code } = t.pairing.start()
    expect(code).toMatch(/^\d{6}$/)
    t.tick(PAIRING.codeTtlMs + 1)
    expect(t.pairing.current()).toBeNull()
    expect(t.pairing.submit(code, 'Laptop')).toEqual({ ok: false, reason: 'expired' })
  })

  it('a code works once', () => {
    const t = setup()
    const { code } = t.pairing.start()
    expect(t.pairing.submit(code, 'Laptop').ok).toBe(true)
    expect(t.pairing.submit(code, 'Laptop again')).toEqual({ ok: false, reason: 'no_pairing' })
  })

  it('five wrong codes lock pairing for ten minutes, even for the right code', () => {
    const t = setup()
    const { code } = t.pairing.start()
    for (let i = 0; i < 4; i++) expect(t.pairing.submit(wrongFor(code), 'x')).toEqual({ ok: false, reason: 'bad_code' })
    expect(t.pairing.submit(wrongFor(code), 'x')).toEqual({ ok: false, reason: 'locked' })
    expect(t.pairing.submit(code, 'x')).toEqual({ ok: false, reason: 'locked' })
    t.tick(PAIRING.lockMs - 1)
    expect(t.pairing.submit(code, 'x')).toEqual({ ok: false, reason: 'locked' })
    t.tick(2)
    // The lock also threw the code away: a new one is needed.
    expect(t.pairing.submit(code, 'x')).toEqual({ ok: false, reason: 'no_pairing' })
    const fresh = t.pairing.start()
    expect(t.pairing.submit(fresh.code, 'x').ok).toBe(true)
  })

  it('guessing with no code on screen counts too', () => {
    const t = setup()
    for (let i = 0; i < 4; i++) t.pairing.submit('000000', 'x')
    expect(t.pairing.submit('000000', 'x')).toEqual({ ok: false, reason: 'locked' })
  })

  it('nothing is issued until the user allows it on the Host; the token is handed out once', () => {
    const t = setup()
    const r = t.pairing.submit(t.pairing.start().code, "Noa's laptop")
    if (!r.ok) throw new Error(r.reason)
    expect(t.pairing.poll(r.requestId)).toEqual({ state: 'pending' })
    expect(t.devices.active()).toEqual([])
    expect(t.pairing.pending()).toEqual([{ id: r.requestId, deviceName: "Noa's laptop", at: expect.any(Number) }])

    expect(t.pairing.answer(r.requestId, true)).toBe(true)
    const first = t.pairing.poll(r.requestId)
    if (first.state !== 'approved') throw new Error(first.state)
    expect(t.devices.verify(first.token)?.name).toBe("Noa's laptop")
    expect(t.pairing.poll(r.requestId)).toEqual({ state: 'unknown' })
    // The Host keeps only a hash of the token.
    expect(readFileSync(t.file, 'utf8')).not.toContain(first.token)
  })

  it('a denied or unanswered request never becomes a device', () => {
    const t = setup()
    const a = t.pairing.submit(t.pairing.start().code, 'A')
    if (!a.ok) throw new Error()
    t.pairing.answer(a.requestId, false)
    expect(t.pairing.poll(a.requestId)).toEqual({ state: 'denied' })
    const b = t.pairing.submit(t.pairing.start().code, 'B')
    if (!b.ok) throw new Error()
    t.tick(PAIRING.requestTtlMs + 1)
    expect(t.pairing.poll(b.requestId)).toEqual({ state: 'expired' })
    expect(t.pairing.answer(b.requestId, true)).toBe(false)
    expect(t.devices.active()).toEqual([])
  })

  it('revoked tokens stop working', () => {
    const t = setup()
    const { device, token } = t.devices.add('Laptop')
    expect(t.devices.verify(token)?.id).toBe(device.id)
    t.devices.revoke(device.id)
    expect(t.devices.verify(token)).toBeNull()
    expect(new DeviceRegistry(t.file).verify(token)).toBeNull()
  })
})
