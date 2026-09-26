import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Manifest } from '@shared/manifest'
import { sampleManifest } from '@shared/test-fixtures'
import { mergeAfterScan, readManifest, writeManifest } from './manifest-store'

function withProject(patch: (p: Manifest['projects'][number]) => void): Manifest {
  const m = sampleManifest()
  patch(m.projects[0]!)
  return m
}

describe('manifest on disk', () => {
  it('validates on every read', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'revive-ms-'))
    expect(await readManifest(folder)).toBeNull()
    mkdirSync(join(folder, '.revive'))
    writeFileSync(join(folder, '.revive/manifest.json'), '{"version": 1}')
    expect((await readManifest(folder))?.ok).toBe(false)
    writeFileSync(join(folder, '.revive/manifest.json'), 'not json')
    expect((await readManifest(folder))?.ok).toBe(false)
    await writeManifest(folder, sampleManifest())
    expect((await readManifest(folder))?.ok).toBe(true)
  })

  it('refuses to write an invalid manifest', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'revive-ms-'))
    mkdirSync(join(folder, '.revive'))
    await expect(writeManifest(folder, withProject((p) => (p.path = '../x')))).rejects.toThrow()
  })
})

describe('merging a new scan', () => {
  it('keeps locked fields exactly as the user set them', () => {
    const prev = withProject((p) => {
      p.name = 'My bakery'
      p.description.he = 'האתר של המאפייה שלי'
      p.user_locked = ['name', 'description.he']
    })
    const next = withProject((p) => {
      p.name = 'Sunrise Bakery Website'
      p.description = { en: 'New English text', he: 'טקסט חדש' }
    })
    const merged = mergeAfterScan(prev, next).projects[0]!
    expect(merged.name).toBe('My bakery')
    expect(merged.description).toEqual({ en: 'New English text', he: 'האתר של המאפייה שלי' })
    expect(merged.user_locked).toEqual(['name', 'description.he'])
  })

  it('never lets a scan claim a project works', () => {
    const next = withProject((p) => {
      p.status = 'verified'
      p.run.verified_at = '2026-09-26T10:00:00.000Z'
    })
    const merged = mergeAfterScan(null, next).projects[0]!
    expect(merged.status).toBe('unknown')
    expect(merged.run.verified_at).toBeNull()
  })

  it('keeps a verified status while the run commands stay the same', () => {
    const prev = withProject((p) => {
      p.run = { install: 'npm install', dev: 'npm run dev', port: 5173, url: null, verified_at: '2026-09-20T10:00:00.000Z' }
      p.status = 'verified'
    })
    const same = withProject((p) => (p.run = { ...prev.projects[0]!.run, verified_at: null }))
    expect(mergeAfterScan(prev, same).projects[0]!.status).toBe('verified')
    expect(mergeAfterScan(prev, same).projects[0]!.run.verified_at).toBe('2026-09-20T10:00:00.000Z')

    const changed = withProject((p) => (p.run = { ...prev.projects[0]!.run, dev: 'npm start' }))
    expect(mergeAfterScan(prev, changed).projects[0]!.status).toBe('unknown')
  })

  it('records the real time of the scan', () => {
    const now = new Date('2026-09-26T14:32:00.000Z')
    expect(mergeAfterScan(null, sampleManifest(), now).scanned_at).toBe('2026-09-26T14:32:00.000Z')
  })

  it('never stores "running"', () => {
    const prev = withProject((p) => (p.status = 'running'))
    expect(mergeAfterScan(prev, sampleManifest()).projects[0]!.status).toBe('unknown')
  })

  it('masks anything that looks like a secret', () => {
    const next = withProject((p) => (p.notes = ['Found OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz in config.js']))
    expect(JSON.stringify(mergeAfterScan(null, next))).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz')
  })
})
