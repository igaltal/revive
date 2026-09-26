import { existsSync, mkdtempSync, readFileSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Manifest } from '@shared/manifest'
import type { ScanProgress } from '@shared/scan'
import { sampleManifest } from '@shared/test-fixtures'
import type { AgentAdapter } from './agent-adapter'
import { runScan } from './scan'
import { readVersions } from '../versions/snapshot'

function sample(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'revive-scan-')), 'projects')
  cpSync('fixtures/sample-folder', dir, { recursive: true })
  writeFileSync(join(dir, 'bakery-site/.env'), 'MAPS_KEY=do-not-touch')
  return dir
}

function fakeAdapter(behave: (folder: string) => void | Promise<void>, result: Awaited<ReturnType<AgentAdapter['scan']>> = { ok: true, costUsd: 0.03 }): AgentAdapter {
  return {
    id: 'fake',
    async scan(folder, { onEvent }) {
      onEvent({ kind: 'read', path: 'bakery-site/index.html' })
      onEvent({ kind: 'read', path: 'habit-counter/package.json' })
      await behave(folder)
      return result
    }
  }
}

const writeManifestAs = (m: unknown) => (folder: string) => writeFileSync(join(folder, '.revive/manifest.json'), JSON.stringify(m))

async function scan(folder: string, adapter: AgentAdapter) {
  const progress: ScanProgress[] = []
  const done = await runScan(folder, { adapter, model: 'haiku', scanId: 's1', signal: new AbortController().signal, onProgress: (p) => progress.push(p) })
  return { done, progress }
}

describe('scan', () => {
  it('saves a version first, streams progress, and stores a merged manifest', async () => {
    const folder = sample()
    const claimed: Manifest = sampleManifest()
    claimed.projects[0]!.status = 'verified'
    const { done, progress } = await scan(folder, fakeAdapter(writeManifestAs(claimed)))

    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(done.costUsd).toBe(0.03)
    expect(done.manifest.projects[0]!.status).toBe('unknown')
    expect((await readVersions(folder))[0]!.kind).toBe('scan')
    expect(existsSync(join(folder, '.revive/schema.json'))).toBe(true)
    expect(progress.map((p) => p.phase)).toEqual(expect.arrayContaining(['saving', 'reading', 'checking', 'done']))
    expect(progress.at(-1)!.projectsFound).toEqual(['bakery-site', 'habit-counter'])
    expect(progress.at(-1)!.filesRead).toBe(2)
  })

  it('puts back anything changed outside .revive/, quarantines new files, and reports it', async () => {
    const folder = sample()
    const { done } = await scan(
      folder,
      fakeAdapter((f) => {
        writeFileSync(join(f, 'notes.txt'), 'overwritten!')
        writeFileSync(join(f, 'stray.txt'), 'created by the scan')
        writeFileSync(join(f, 'bakery-site/.env'), 'MAPS_KEY=changed')
        writeManifestAs(sampleManifest())(f)
      })
    )
    expect(done.ok).toBe(false)
    if (done.ok) return
    expect(done.error.code).toBe('modified_outside')
    expect(done.error.restored).toEqual(['notes.txt'])
    expect(done.error.quarantined).toEqual(['stray.txt'])
    expect(done.error.unrestorable).toEqual(['bakery-site/.env'])
    expect(readFileSync(join(folder, 'notes.txt'), 'utf8')).toContain('garden planner')
    expect(existsSync(join(folder, 'stray.txt'))).toBe(false)
    expect(existsSync(join(folder, '.revive/manifest.json'))).toBe(false)
  })

  it('keeps the previous project list when Claude writes something unreadable', async () => {
    const folder = sample()
    await scan(folder, fakeAdapter(writeManifestAs(sampleManifest())))
    const { done } = await scan(folder, fakeAdapter((f) => writeFileSync(join(f, '.revive/manifest.json'), '{"version": 2, "projects": "oops"}')))
    expect(done.ok).toBe(false)
    if (done.ok) return
    expect(done.error.code).toBe('invalid_manifest')
    expect(done.error.detail!.length).toBeGreaterThan(0)
    expect(JSON.parse(readFileSync(join(folder, '.revive/manifest.json'), 'utf8')).projects[0].id).toBe('bakery-site')
    expect(existsSync(join(folder, '.revive/manifest.rejected.json'))).toBe(true)
  })

  it('passes agent failures through and keeps the previous list', async () => {
    const folder = sample()
    await scan(folder, fakeAdapter(writeManifestAs(sampleManifest())))
    const { done } = await scan(folder, fakeAdapter(() => {}, { ok: false, code: 'auth', costUsd: null }))
    expect(done.ok).toBe(false)
    if (!done.ok) expect(done.error.code).toBe('auth')
    expect(JSON.parse(readFileSync(join(folder, '.revive/manifest.json'), 'utf8')).projects).toHaveLength(1)
  })
})
