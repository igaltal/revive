import { describe, expect, it } from 'vitest'
import { VITALS_INTERVAL_MS, VITALS_LEASE_MS } from '@shared/vitals'
import { RuntimeBus } from '../runtime-bus'
import { VitalsService, type Clock, type Reading } from './vitals-service'

/** A clock the test moves by hand. */
function fakeClock() {
  let now = 1_000_000
  const timers: Array<{ ms: number; next: number; fn: () => void; on: boolean }> = []
  const clock: Clock = {
    now: () => now,
    every: (ms, fn) => {
      const t = { ms, next: now + ms, fn, on: true }
      timers.push(t)
      return () => (t.on = false)
    }
  }
  const advance = async (ms: number) => {
    const end = now + ms
    for (;;) {
      const due = timers.filter((t) => t.on && t.next <= end).sort((a, b) => a.next - b.next)[0]
      if (!due) break
      now = due.next
      due.next += due.ms
      due.fn()
      await new Promise((r) => setTimeout(r, 0))
    }
    now = end
  }
  return { clock, advance, running: () => timers.filter((t) => t.on).length }
}

const reading: Reading = { machine: { name: 'Studio', cpu: 'Apple M4', cores: 10, memoryBytes: 24 * 1024 ** 3 }, cpu: 18, memory: 59, disk: 41, temperature: null, uptimeSeconds: 3600, ollama: { state: 'running', models: ['qwen3:14b'] } }

function setup() {
  let samples = 0
  const bus = new RuntimeBus()
  const events: number[] = []
  bus.subscribe((e) => e.type === 'vitals.updated' && events.push(e.vitals.cpu))
  const c = fakeClock()
  const vitals = new VitalsService({ sample: async () => (samples++, { ...reading, cpu: 10 + samples }) }, bus, c.clock)
  vitals.setSources({ tailscale: () => 'serving', devicesOnline: () => 2 })
  return { vitals, bus, events, samples: () => samples, ...c }
}

describe('vitals are sampled only while someone watches', () => {
  it('samples nothing until a client watches, then every 5 seconds', async () => {
    const t = setup()
    await t.advance(60_000)
    expect(t.samples()).toBe(0)
    expect(t.vitals.active).toBe(false)

    const { leaseId } = t.vitals.watch()
    await t.advance(0)
    expect(t.samples()).toBe(1)
    await t.advance(VITALS_INTERVAL_MS * 3)
    expect(t.samples()).toBe(4)
    // Each sample is a state event on the stream, with what the service adds.
    expect(t.events).toEqual([11, 12, 13, 14])
    const last = t.bus.since(0).filter((e) => e.type === 'vitals.updated')
    expect(last).toHaveLength(1) // only the latest is kept for replay
    expect(last[0]).toMatchObject({ vitals: { tailscale: 'serving', devicesOnline: 2, cpuHistory: [11, 12, 13, 14] } })

    t.vitals.unwatch(leaseId)
    expect(t.vitals.active).toBe(false)
    expect(t.running()).toBe(0)
    await t.advance(60_000)
    expect(t.samples()).toBe(4)
  })

  it('stops by itself when a client goes away without saying so (its lease runs out)', async () => {
    const t = setup()
    t.vitals.watch()
    await t.advance(VITALS_LEASE_MS - 1)
    expect(t.vitals.active).toBe(true)
    await t.advance(VITALS_INTERVAL_MS + 1)
    expect(t.vitals.active).toBe(false)
    const n = t.samples()
    await t.advance(60_000)
    expect(t.samples()).toBe(n)
  })

  it('keeps going while any client still watches, and renewing keeps a lease alive', async () => {
    const t = setup()
    const a = t.vitals.watch()
    const b = t.vitals.watch()
    expect(a.leaseId).not.toBe(b.leaseId)
    t.vitals.unwatch(a.leaseId)
    expect(t.vitals.active).toBe(true)
    for (let i = 0; i < 6; i++) {
      await t.advance(VITALS_LEASE_MS / 2)
      expect(t.vitals.watch(b.leaseId).leaseId).toBe(b.leaseId)
    }
    expect(t.vitals.active).toBe(true)
    t.vitals.unwatch(b.leaseId)
    expect(t.vitals.active).toBe(false)
    expect(t.vitals.watchers).toBe(0)
  })
})
