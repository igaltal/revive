import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ScanDone, ScanProgress } from '@shared/scan'
import type { AgentAdapter, UnderstandInput } from './agent-adapter'
import { runScan } from './scan'
import { readManifest, updateProject } from '../manifest-store'
import { fingerprint } from './fs-fingerprint'

function sample(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'revive-scan-')), 'projects')
  cpSync('fixtures/sample-folder', dir, { recursive: true })
  writeFileSync(join(dir, 'bakery-site/.env'), 'MAPS_KEY=do-not-touch')
  writeFileSync(join(dir, 'habit-counter/src/weather.js'), 'export const key = import.meta.env.VITE_WEATHER_KEY\n')
  return dir
}

/** A stand-in agent that records what it was shown. */
function agent(opts: { fail?: (ids: string[]) => Awaited<ReturnType<AgentAdapter['understand']>> | null; ready?: Awaited<ReturnType<AgentAdapter['ready']>> } = {}) {
  const calls: UnderstandInput[][] = []
  const adapter: AgentAdapter = {
    id: 'fake',
    ready: async () => opts.ready ?? { ok: true },
    async understand(projects) {
      calls.push(projects)
      const failure = opts.fail?.(projects.map((p) => p.id))
      if (failure) return failure
      return {
        ok: true,
        costUsd: 0.01,
        projects: projects.map((p) => ({
          id: p.id,
          name: p.id === 'bakery-site' ? 'Sunrise Bakery' : 'Habit counter',
          en: `About ${p.id}.`,
          he: `על ${p.id}.`,
          keys: p.digest.keys.map((key) => ({ key, en: 'to show the weather', he: 'להצגת מזג האוויר' })),
          notes: []
        }))
      }
    }
  }
  return { adapter, calls }
}

async function scan(folder: string, adapter: AgentAdapter, signal = new AbortController().signal) {
  const progress: ScanProgress[] = []
  const done = await runScan(folder, { adapter, model: 'sonnet', scanId: 's1', signal, onProgress: (p) => progress.push(p) })
  return { done, progress }
}

const ok = (d: ScanDone) => {
  if (!d.ok) throw new Error(`scan failed: ${d.error.code}`)
  return d
}

describe('reading a folder', () => {
  it('finds the projects itself, asks Claude only for words, and writes the manifest', async () => {
    const folder = sample()
    const before = await fingerprint(folder)
    const { adapter, calls } = agent()
    const { done, progress } = await scan(folder, adapter)
    const d = ok(done)

    expect(d.summary).toMatchObject({ found: 2, understood: 2, unchanged: 0, failed: [] })
    expect(d.costUsd).toBeCloseTo(0.01)
    // Claude saw a summary, never a secret.
    expect(JSON.stringify(calls)).not.toContain('do-not-touch')
    expect(calls[0]!.find((p) => p.id === 'habit-counter')!.digest.keys).toEqual(['VITE_WEATHER_KEY'])

    const m = (await readManifest(folder))!
    expect(m.ok).toBe(true)
    if (!m.ok) return
    const habit = m.manifest.projects.find((p) => p.id === 'habit-counter')!
    expect(habit).toMatchObject({ name: 'Habit counter', description: { en: 'About habit-counter.', he: 'על habit-counter.' }, run: { install: 'npm install', dev: 'npm run dev', port: 5199, url: 'http://localhost:5199' } })
    expect(habit.keys).toEqual([{ key: 'VITE_WEATHER_KEY', required: true, purpose: { en: 'to show the weather', he: 'להצגת מזג האוויר' } }])
    expect(m.manifest.loose_files).toEqual(['notes.txt'])

    // Progress: every project by name, from found to done.
    expect(progress.map((p) => p.phase)).toEqual(expect.arrayContaining(['finding', 'understanding', 'checking', 'done']))
    expect(progress.at(-1)!.projects.map((p) => [p.path, p.state])).toEqual([
      ['bakery-site', 'done'],
      ['habit-counter', 'done']
    ])
    expect(progress.find((p) => p.phase === 'understanding')!.estimateUsd).toBeGreaterThan(0)

    // Nothing outside .revive/ changed.
    const after = await fingerprint(folder)
    expect([...after.entries()]).toEqual([...before.entries()])
  })

  it('the second time, only what changed goes to Claude; what the person set stays', async () => {
    const folder = sample()
    await scan(folder, agent().adapter)
    await updateProject(folder, 'bakery-site', (p) => {
      p.description.en = 'My own words'
      p.user_locked = ['description.en']
      p.status = 'verified'
    })

    const nothing = agent()
    const again = ok((await scan(folder, nothing.adapter)).done)
    expect(nothing.calls).toEqual([])
    expect(again.summary).toMatchObject({ understood: 0, unchanged: 2 })
    expect(again.costUsd).toBeNull()

    writeFileSync(join(folder, 'habit-counter/src/extra.js'), 'export {}')
    const changed = agent()
    const third = ok((await scan(folder, changed.adapter)).done)
    expect(changed.calls.flat().map((p) => p.id)).toEqual(['habit-counter'])
    expect(third.summary).toMatchObject({ understood: 1, unchanged: 1 })
    const bakery = third.manifest.projects.find((p) => p.id === 'bakery-site')!
    expect(bakery.description.en).toBe('My own words')
    expect(bakery.status).toBe('verified')
  })

  it('a batch that fails keeps what was known, and is tried again next time', async () => {
    const folder = sample()
    const { adapter } = agent({ fail: (ids) => (ids.length ? { ok: false, code: 'timeout', costUsd: null } : null) })
    const d = ok((await scan(folder, adapter)).done)
    expect(d.summary.failed.sort()).toEqual(['bakery-site', 'habit-counter'])
    // The facts from the files are there even without words.
    expect(d.manifest.projects.find((p) => p.id === 'habit-counter')!.run.port).toBe(5199)
    const state = JSON.parse(readFileSync(join(folder, '.revive/scan-state.json'), 'utf8'))
    expect(state.projects).toEqual({})
    const retry = agent()
    await scan(folder, retry.adapter)
    expect(retry.calls.flat().length).toBe(2)
  })

  it('stops at once when Claude is signed out, before spending anything, and changes nothing', async () => {
    const folder = sample()
    const { adapter, calls } = agent({ ready: { ok: false, code: 'auth' } })
    const { done } = await scan(folder, adapter)
    expect(done).toMatchObject({ ok: false, error: { code: 'auth' } })
    expect(calls).toEqual([])
    expect(await readManifest(folder)).toBeNull()
  })

  it('can be stopped', async () => {
    const folder = sample()
    const ac = new AbortController()
    ac.abort()
    const { done } = await scan(folder, agent().adapter, ac.signal)
    expect(done).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})
