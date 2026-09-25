import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addRecent, checkFolder, describeRecent, isTooBroad, MAX_RECENT } from './folders'

const home = '/Users/noa'

describe('folder checks', () => {
  it('refuses folders that are too broad to read', () => {
    for (const p of ['/', '/Users', home, '/System', '/Applications', `${home}/Library`, `${home}/Library/Caches`]) {
      expect(isTooBroad(p, home), p).toBe(true)
    }
    for (const p of [`${home}/Documents`, `${home}/Documents/Projects`, `${home}/Desktop/ai-stuff`]) {
      expect(isTooBroad(p, home), p).toBe(false)
    }
  })

  it('accepts a readable folder and reports problems in plain categories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'revive-folder-'))
    mkdirSync(join(dir, 'projects'))
    writeFileSync(join(dir, 'file.txt'), 'x')
    const good = await checkFolder(join(dir, 'projects'), home)
    expect(good).toMatchObject({ ok: true, name: 'projects' })
    expect(await checkFolder(join(dir, 'nope'), home)).toMatchObject({ ok: false, problem: 'missing' })
    expect(await checkFolder(join(dir, 'file.txt'), home)).toMatchObject({ ok: false, problem: 'not-directory' })
  })

  it('keeps recent folders unique, newest first, capped', () => {
    let list: string[] = []
    for (let i = 0; i < MAX_RECENT + 3; i++) list = addRecent(list, `/p/${i}`)
    list = addRecent(list, '/p/5')
    expect(list[0]).toBe('/p/5')
    expect(list).toHaveLength(MAX_RECENT)
    expect(new Set(list).size).toBe(list.length)
  })

  it('marks recent folders that no longer exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'revive-recent-'))
    const [a, b] = await describeRecent([dir, join(dir, 'gone')])
    expect(a!.exists).toBe(true)
    expect(b!.exists).toBe(false)
  })
})
