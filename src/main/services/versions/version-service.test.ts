import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Manifest } from '@shared/manifest'
import type { StateEvent } from '@shared/runtime'
import { sampleManifest } from '@shared/test-fixtures'
import { RuntimeBus } from '../runtime-bus'
import { writeManifest } from '../../manifest-store'
import { VersionService } from './version-service'

function write(root: string, rel: string, text: string) {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), text)
}
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8')
const sh = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Noa', GIT_AUTHOR_EMAIL: 'n@x', GIT_COMMITTER_NAME: 'Noa', GIT_COMMITTER_EMAIL: 'n@x' } }).trim()

function manifest(): Manifest {
  const m = sampleManifest()
  const base = m.projects[0]!
  m.projects = [
    { ...structuredClone(base), id: 'bakery', path: 'bakery', status: 'verified', run: { ...base.run, verified_at: '2026-09-27T10:00:00.000Z' } },
    { ...structuredClone(base), id: 'habits', path: 'habits', status: 'verified' }
  ]
  return m
}

async function setup(opts: { git?: boolean } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'revive-versions-'))
  write(folder, 'bakery/index.html', '<h1>Bakery v1</h1>')
  write(folder, 'bakery/menu.txt', 'bread')
  write(folder, 'bakery/.env', 'MAPS_KEY=original')
  write(folder, 'bakery/node_modules/dep/index.js', 'dep v1')
  write(folder, 'habits/index.html', '<h1>Habits</h1>')
  if (opts.git) {
    sh(folder, 'init', '-q', '-b', 'main')
    write(folder, '.gitignore', 'node_modules\n.env\n')
    sh(folder, 'add', '-A')
    sh(folder, 'commit', '-qm', 'first')
  }
  mkdirSync(join(folder, '.revive'), { recursive: true })
  await writeManifest(folder, manifest())
  const bus = new RuntimeBus()
  const events: StateEvent[] = []
  bus.subscribe((e) => e.type !== 'process.output' && events.push(e))
  const running = new Map<string, string>([['bakery', 'running'], ['habits', 'running']])
  const stopped: string[] = []
  let scanning = false
  const service = new VersionService({
    bus,
    folder: async () => folder,
    runner: {
      get: (id) => (running.has(id) ? { status: running.get(id)! } : null),
      stop: async (id) => {
        stopped.push(id)
        running.set(id, 'stopped')
      }
    },
    scanning: () => scanning
  })
  return { folder, service, events, stopped, setScanning: (v: boolean) => (scanning = v) }
}

describe('going back to a saved version', () => {
  it('puts files back, moves new files to the trash, never touches keys or dependencies, and can be undone', async () => {
    const t = await setup()
    const v1 = await t.service.save()

    write(t.folder, 'bakery/index.html', '<h1>Bakery v2</h1>')
    rmSync(join(t.folder, 'bakery/menu.txt'))
    write(t.folder, 'bakery/new-page.html', 'new')
    write(t.folder, 'bakery/.env', 'MAPS_KEY=changed-since')
    write(t.folder, 'bakery/node_modules/dep/index.js', 'dep v2')

    const preview = await t.service.preview({ versionId: v1.id })
    expect(preview).toMatchObject({ changedFiles: 2, newFiles: 1, willStop: ['bakery'] })
    expect(read(t.folder, 'bakery/index.html')).toBe('<h1>Bakery v2</h1>') // preview writes nothing

    const r = await t.service.restore({ versionId: v1.id })
    if (!r.ok) throw new Error(r.code)
    expect(read(t.folder, 'bakery/index.html')).toBe('<h1>Bakery v1</h1>')
    expect(read(t.folder, 'bakery/menu.txt')).toBe('bread')
    expect(existsSync(join(t.folder, 'bakery/new-page.html'))).toBe(false)
    expect(r.movedToTrash).toEqual(['bakery/new-page.html'])
    const trashed = readdirSync(join(t.folder, '.revive/trash'))
    expect(read(t.folder, `.revive/trash/${trashed[0]}/bakery/new-page.html`)).toBe('new')
    // Keys and dependencies are not part of any version, so a restore leaves them as they are.
    expect(read(t.folder, 'bakery/.env')).toBe('MAPS_KEY=changed-since')
    expect(read(t.folder, 'bakery/node_modules/dep/index.js')).toBe('dep v2')
    expect(r.changedFiles).toBe(3)

    // Only the project whose files changed was stopped, and offered back.
    expect(t.stopped).toEqual(['bakery'])
    expect(r.stoppedProjects).toEqual(['bakery'])
    const stored = JSON.parse(read(t.folder, '.revive/manifest.json')) as Manifest
    expect(stored.projects.map((p) => [p.id, p.status, p.run.verified_at])).toEqual([
      ['bakery', 'unknown', null],
      ['habits', 'verified', null]
    ])

    // On the stream: the undo point, then the restore.
    const types = t.events.map((e) => e.type)
    expect(types).toEqual(['version.saved', 'version.saved', 'manifest.changed', 'version.restored'])
    expect(t.events.at(-1)).toMatchObject({ versionId: v1.id, undoVersionId: r.undoVersionId, stoppedProjects: ['bakery'] })

    // Undo: the folder is as it was just before going back.
    const u = await t.service.undo({ versionId: r.undoVersionId })
    expect(u.ok).toBe(true)
    expect(read(t.folder, 'bakery/index.html')).toBe('<h1>Bakery v2</h1>')
    expect(read(t.folder, 'bakery/new-page.html')).toBe('new')
    expect(existsSync(join(t.folder, 'bakery/menu.txt'))).toBe(false)
    expect(read(t.folder, 'bakery/.env')).toBe('MAPS_KEY=changed-since')

    const list = await t.service.list()
    expect(list.map((v) => v.kind)).toEqual(['undo', 'restore', 'manual'])
    expect(list[1]).toMatchObject({ restoredFrom: v1.id, title: { en: 'Before going back to an earlier version' } })
    expect(JSON.stringify(list)).not.toMatch(/commit|parts/)
  })

  it("inside the user's own repo: HEAD, branch and index are exactly as they were", async () => {
    const t = await setup({ git: true })
    const v1 = await t.service.save()
    write(t.folder, 'bakery/index.html', '<h1>edited</h1>')
    const head = sh(t.folder, 'rev-parse', 'HEAD')
    const branch = sh(t.folder, 'rev-parse', '--abbrev-ref', 'HEAD')
    const index = createHash('sha1').update(readFileSync(join(t.folder, '.git/index'))).digest('hex')

    const r = await t.service.restore({ versionId: v1.id })
    expect(r.ok).toBe(true)
    expect(read(t.folder, 'bakery/index.html')).toBe('<h1>Bakery v1</h1>')
    expect(sh(t.folder, 'rev-parse', 'HEAD')).toBe(head)
    expect(sh(t.folder, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(branch)
    expect(createHash('sha1').update(readFileSync(join(t.folder, '.git/index'))).digest('hex')).toBe(index)
    expect(sh(t.folder, 'status', '--porcelain')).toBe('')
  })

  it('checks every input, and waits for a scan', async () => {
    const t = await setup()
    await expect(t.service.restore({ versionId: '../../etc' })).rejects.toThrow()
    await expect(t.service.restore({})).rejects.toThrow()
    expect(await t.service.restore({ versionId: 'v-20260101T000000Z-abcde' })).toEqual({ ok: false, code: 'not_found' })
    const v = await t.service.save()
    t.setScanning(true)
    expect(await t.service.restore({ versionId: v.id })).toEqual({ ok: false, code: 'busy' })
  })
})

describe('the trash', () => {
  it('is emptied only with an explicit confirmation, and says so on the stream', async () => {
    const t = await setup()
    const v1 = await t.service.save()
    write(t.folder, 'habits/extra.txt', 'x'.repeat(100))
    await t.service.restore({ versionId: v1.id })
    expect(await t.service.trash()).toEqual({ items: 1, bytes: 100 })

    await expect(t.service.emptyTrash({})).rejects.toThrow()
    await expect(t.service.emptyTrash({ confirm: 'yes' })).rejects.toThrow()
    expect((await t.service.trash()).items).toBe(1)

    expect(await t.service.emptyTrash({ confirm: true })).toEqual({ items: 0, bytes: 0 })
    expect(existsSync(join(t.folder, '.revive/trash'))).toBe(false)
    expect(t.events.at(-1)).toMatchObject({ type: 'trash.emptied', removedItems: 1 })
  })
})
