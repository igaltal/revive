import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { moveAside, readVersions, restoreFiles, saveVersion } from './snapshot'

const title = { en: 'Before reading the folder', he: 'לפני קריאת התיקייה' }

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Noa', GIT_AUTHOR_EMAIL: 'noa@example.com', GIT_COMMITTER_NAME: 'Noa', GIT_COMMITTER_EMAIL: 'noa@example.com' }
  }).trim()
}

function write(root: string, rel: string, text: string) {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), text)
}

const hashFile = (p: string) => createHash('sha1').update(readFileSync(p)).digest('hex')

function tree(folder: string, part: { dir: string; mode: string; commit: string }): string[] {
  const gitArgs = part.mode === 'shadow' ? ['--git-dir', join(folder, '.revive/git')] : []
  return sh(join(folder, part.dir), ...gitArgs, 'ls-tree', '-r', '--name-only', part.commit).split('\n').filter(Boolean)
}

describe('saved versions without a git repo (shadow repo)', () => {
  it('saves everything except keys, dependencies, builds, big files and .revive', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'revive-v-'))
    write(folder, 'site/index.html', '<h1>hi</h1>')
    write(folder, 'site/.env', 'SECRET=1')
    write(folder, 'site/.env.local', 'SECRET=2')
    write(folder, 'site/node_modules/x/index.js', 'dep')
    write(folder, 'site/dist/bundle.js', 'built')
    write(folder, 'notes.txt', 'n')
    write(folder, 'video.mov', '')
    truncateSync(join(folder, 'video.mov'), 51 * 1024 * 1024)

    const v = await saveVersion(folder, title, 'scan')
    expect(v.parts).toHaveLength(1)
    expect(v.parts[0]!.mode).toBe('shadow')
    expect(tree(folder, v.parts[0]!).sort()).toEqual(['notes.txt', 'site/index.html'])
    expect(existsSync(join(folder, '.revive/.gitignore'))).toBe(true)
    expect((await readVersions(folder)).map((r) => r.id)).toEqual([v.id])
  })

  it('puts a changed file back, and never touches .env', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'revive-v-'))
    write(folder, 'site/index.html', 'original')
    write(folder, 'site/.env', 'KEY=before')
    const v = await saveVersion(folder, title, 'scan')

    write(folder, 'site/index.html', 'changed by someone')
    write(folder, 'site/.env', 'KEY=after')
    const r = await restoreFiles(folder, v, ['site/index.html', 'site/.env'])
    expect(r).toEqual({ restored: ['site/index.html'], notInVersion: ['site/.env'] })
    expect(readFileSync(join(folder, 'site/index.html'), 'utf8')).toBe('original')
    expect(readFileSync(join(folder, 'site/.env'), 'utf8')).toBe('KEY=after')
  })
})

describe("saved versions inside the user's own git repo", () => {
  it("never touches HEAD, branches, the index, the stash or the working tree", async () => {
    const folder = mkdtempSync(join(tmpdir(), 'revive-u-'))
    sh(folder, 'init', '-q', '-b', 'main')
    write(folder, 'app.js', 'v1')
    write(folder, '.gitignore', 'secret.txt\n')
    sh(folder, 'add', '.')
    sh(folder, 'commit', '-q', '-m', 'first')
    write(folder, 'app.js', 'v2 stashed')
    sh(folder, 'stash', '-q')
    sh(folder, 'checkout', '-q', '-b', 'feature')
    write(folder, 'app.js', 'v3 staged')
    sh(folder, 'add', 'app.js')
    write(folder, 'app.js', 'v4 working copy')
    write(folder, 'untracked.md', 'draft')
    write(folder, 'secret.txt', 'ignored')

    const before = {
      head: sh(folder, 'rev-parse', 'HEAD'),
      symbolic: sh(folder, 'symbolic-ref', 'HEAD'),
      branches: sh(folder, 'for-each-ref', 'refs/heads', 'refs/tags'),
      stash: sh(folder, 'stash', 'list'),
      status: sh(folder, 'status', '--porcelain'),
      index: hashFile(join(folder, '.git/index'))
    }

    const v = await saveVersion(folder, title, 'scan')

    expect({
      head: sh(folder, 'rev-parse', 'HEAD'),
      symbolic: sh(folder, 'symbolic-ref', 'HEAD'),
      branches: sh(folder, 'for-each-ref', 'refs/heads', 'refs/tags'),
      stash: sh(folder, 'stash', 'list'),
      status: sh(folder, 'status', '--porcelain'),
      index: hashFile(join(folder, '.git/index'))
    }).toEqual(before)

    expect(v.parts[0]!.mode).toBe('user')
    expect(sh(folder, 'rev-parse', 'refs/revive/latest')).toBe(v.parts[0]!.commit)
    // The version holds the working copy, including untracked work, but not ignored files.
    expect(sh(folder, 'show', `${v.parts[0]!.commit}:app.js`)).toBe('v4 working copy')
    expect(tree(folder, v.parts[0]!)).toContain('untracked.md')
    expect(tree(folder, v.parts[0]!)).not.toContain('secret.txt')
    expect(existsSync(join(folder, '.revive/git'))).toBe(false)
  })
})

describe('a folder of projects where some have their own repo', () => {
  it('uses refs/revive in each nested repo and the shadow repo for the rest', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'revive-n-'))
    write(folder, 'loose/notes.txt', 'n')
    write(folder, 'app/src/main.js', 'one')
    sh(join(folder, 'app'), 'init', '-q', '-b', 'main')
    sh(join(folder, 'app'), 'add', '.')
    sh(join(folder, 'app'), 'commit', '-q', '-m', 'init')
    const appHead = sh(join(folder, 'app'), 'rev-parse', 'HEAD')

    const v = await saveVersion(folder, title, 'scan')
    const shadow = v.parts.find((p) => p.mode === 'shadow')!
    const app = v.parts.find((p) => p.dir === 'app')!
    expect(tree(folder, shadow)).toEqual(['loose/notes.txt'])
    expect(tree(folder, app)).toEqual(['src/main.js'])
    expect(sh(join(folder, 'app'), 'rev-parse', 'HEAD')).toBe(appHead)

    write(folder, 'app/src/main.js', 'broken')
    const r = await restoreFiles(folder, v, ['app/src/main.js'])
    expect(r.restored).toEqual(['app/src/main.js'])
    expect(readFileSync(join(folder, 'app/src/main.js'), 'utf8')).toBe('one')
    expect(sh(join(folder, 'app'), 'status', '--porcelain')).toBe('')
  })
})

describe('moving files aside', () => {
  it('moves instead of deleting', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'revive-m-'))
    write(folder, 'stray/new.txt', 'made by the scan')
    const moved = await moveAside(folder, 'quarantine', ['stray/new.txt', 'missing.txt'], 'stamp')
    expect(moved).toEqual(['stray/new.txt'])
    expect(existsSync(join(folder, 'stray/new.txt'))).toBe(false)
    expect(readFileSync(join(folder, '.revive/quarantine/stamp/stray/new.txt'), 'utf8')).toBe('made by the scan')
  })
})
