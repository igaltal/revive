import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import type { VersionKind, VersionPart, VersionRecord } from '@shared/versions'
import { walk } from '../fs-walk'
import { excludeGlob, excludeLiteral, git, type GitEnv } from './git'

export const MAX_FILE_BYTES = 50 * 1024 * 1024

/** Never part of a saved version: dependencies, builds, Revive itself, and keys. */
export const ALWAYS_EXCLUDED = ['**/node_modules/**', '**/build/**', '**/dist/**', '**/.venv/**', '**/.env', '**/.env.*', '.revive/**']

const reviveDir = (folder: string) => join(folder, '.revive')
const versionsFile = (folder: string) => join(reviveDir(folder), 'versions.json')

function newId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  return `v-${stamp}-${Math.random().toString(36).slice(2, 7)}`
}

/** .revive/ must never show up in the user's own `git status`. */
export async function ensureReviveDir(folder: string): Promise<void> {
  await mkdir(reviveDir(folder), { recursive: true })
  const ignore = join(reviveDir(folder), '.gitignore')
  if (!existsSync(ignore)) await writeFile(ignore, '# Revive keeps its own notes here.\n*\n')
}

function partEnv(folder: string, part: Pick<VersionPart, 'dir' | 'mode'>): GitEnv {
  const root = join(folder, part.dir)
  if (part.mode === 'shadow') {
    const gitDir = join(reviveDir(folder), 'git')
    return { cwd: folder, gitDir, workTree: folder, indexFile: join(gitDir, 'index') }
  }
  // The user's repo: a private index so their staging area is never touched.
  const key = createHash('sha1').update(part.dir).digest('hex').slice(0, 12)
  return { cwd: root, indexFile: join(reviveDir(folder), 'indexes', `${key}.index`) }
}

async function ensureShadowRepo(folder: string): Promise<void> {
  const gitDir = join(reviveDir(folder), 'git')
  if (existsSync(join(gitDir, 'HEAD'))) return
  await mkdir(gitDir, { recursive: true })
  await git({ cwd: folder }).raw(['init', '--quiet', '--bare', gitDir])
  await git({ cwd: folder, gitDir }).raw(['config', 'core.bare', 'false'])
}

/** Seeds Revive's private index from the user's, so unchanged files are not re-read. */
async function seedUserIndex(env: GitEnv): Promise<void> {
  if (!env.indexFile || existsSync(env.indexFile)) return
  await mkdir(dirname(env.indexFile), { recursive: true })
  const userIndex = await git({ cwd: env.cwd }).raw(['rev-parse', '--path-format=absolute', '--git-path', 'index'])
  if (userIndex && existsSync(userIndex.trim())) await copyFile(userIndex.trim(), env.indexFile)
}

export async function readVersions(folder: string): Promise<VersionRecord[]> {
  try {
    return JSON.parse(await readFile(versionsFile(folder), 'utf8')) as VersionRecord[]
  } catch {
    return []
  }
}

async function appendVersion(folder: string, record: VersionRecord): Promise<void> {
  const all = await readVersions(folder)
  all.push(record)
  const tmp = `${versionsFile(folder)}.tmp`
  await writeFile(tmp, JSON.stringify(all, null, 2))
  await rename(tmp, versionsFile(folder))
}

/** Which repositories make up this folder. */
export async function discoverParts(folder: string): Promise<{ parts: Array<Pick<VersionPart, 'dir' | 'mode'>>; bigFiles: string[] }> {
  const { files, repos } = await walk(folder)
  const rootIsRepo = existsSync(join(folder, '.git'))
  const parts: Array<Pick<VersionPart, 'dir' | 'mode'>> = [{ dir: '.', mode: rootIsRepo ? 'user' : 'shadow' }]
  for (const r of repos) parts.push({ dir: r, mode: 'user' })
  const bigFiles = files.filter((f) => f.size > MAX_FILE_BYTES).map((f) => f.rel)
  return { parts, bigFiles }
}

function within(dir: string, rel: string): string | null {
  if (dir === '.') return rel
  return rel === dir || rel.startsWith(`${dir}/`) ? posix.relative(dir, rel) : null
}

/**
 * Saves a version of the whole folder. Uses only plumbing (add into a private
 * index, write-tree, commit-tree, update-ref): the user's HEAD, branches,
 * index and stash stay exactly as they were.
 */
export async function saveVersion(folder: string, title: VersionRecord['title'], kind: VersionKind, extra: Partial<VersionRecord> = {}): Promise<VersionRecord> {
  await ensureReviveDir(folder)
  const { parts: found, bigFiles } = await discoverParts(folder)
  const id = newId()
  const parts: VersionPart[] = []

  for (const part of found) {
    if (part.mode === 'shadow') await ensureShadowRepo(folder)
    const env = partEnv(folder, part)
    if (part.mode === 'user') await seedUserIndex(env)
    const g = git(env)

    // Nested repositories belong to their own part, not to this one.
    const nested = found.map((o) => (o.dir !== part.dir ? within(part.dir, o.dir) : null)).filter((p): p is string => !!p && p.length > 0)
    const big = bigFiles.map((f) => within(part.dir, f)).filter((p): p is string => !!p)
    const pathspecs = ['.', ...ALWAYS_EXCLUDED.map(excludeGlob), ...nested.map(excludeLiteral), ...big.map(excludeLiteral)]

    await g.raw(['add', '--all', '--ignore-errors', '--', ...pathspecs])
    const tree = await g.raw(['write-tree'])
    const parent = (await g.raw(['rev-parse', '--quiet', '--verify', 'refs/revive/latest']).catch(() => '')).trim()
    const message = `Revive: ${title.en}\n\nrevive-version: ${id}\nkind: ${kind}\n`
    const commitArgs = ['commit-tree', '--no-gpg-sign', tree.trim(), ...(parent ? ['-p', parent] : []), '-m', message]
    const commit = (await g.raw(commitArgs)).trim()
    await g.raw(['update-ref', `refs/revive/versions/${id}`, commit])
    await g.raw(['update-ref', 'refs/revive/latest', commit])
    parts.push({ ...part, commit })
  }

  const record: VersionRecord = { id, title, kind, createdAt: new Date().toISOString(), parts, ...extra }
  await appendVersion(folder, record)
  return record
}

/** Picks the part that owns a path: the deepest repository containing it. */
export function partFor(record: VersionRecord, rel: string): { part: VersionPart; inner: string } | null {
  let best: { part: VersionPart; inner: string } | null = null
  for (const part of record.parts) {
    const inner = within(part.dir, rel)
    if (inner !== null && (!best || part.dir.length > best.part.dir.length)) best = { part, inner }
  }
  return best
}

/**
 * Writes the saved copy of specific files back. Uses a throwaway index, so
 * nothing else in the user's repo changes. Files that are not in the version
 * (new files, ignored files such as .env) are reported, never touched.
 */
export async function restoreFiles(folder: string, record: VersionRecord, rels: string[]): Promise<{ restored: string[]; notInVersion: string[] }> {
  const restored: string[] = []
  const notInVersion: string[] = []
  const groups = new Map<VersionPart, string[]>()
  for (const rel of rels) {
    const hit = partFor(record, rel)
    if (!hit) {
      notInVersion.push(rel)
      continue
    }
    groups.set(hit.part, [...(groups.get(hit.part) ?? []), hit.inner])
  }

  for (const [part, inners] of groups) {
    const tmp = await mkdtemp(join(tmpdir(), 'revive-restore-'))
    try {
      // For the user's repo, running inside it is enough: its top level is the part's folder.
      const g = git({ ...partEnv(folder, part), indexFile: join(tmp, 'index') })
      await g.raw(['read-tree', part.commit])
      const listed = await g.raw(['ls-files', '-z', '--', ...inners.map((p) => `:(literal)${p}`)])
      const present = new Set(listed.split('\0').filter(Boolean))
      const toWrite = inners.filter((p) => present.has(p))
      if (toWrite.length > 0) await g.raw(['checkout-index', '--force', '--', ...toWrite])
      for (const inner of inners) {
        const rel = part.dir === '.' ? inner : `${part.dir}/${inner}`
        ;(present.has(inner) ? restored : notInVersion).push(rel)
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }
  return { restored, notInVersion }
}

/** Moves files aside into .revive/<bucket>/<stamp>/. Revive never deletes user files. */
export async function moveAside(folder: string, bucket: 'quarantine' | 'trash', rels: string[], stamp = new Date().toISOString().replace(/[:.]/g, '-')): Promise<string[]> {
  const moved: string[] = []
  for (const rel of rels) {
    const from = join(folder, rel)
    if (!existsSync(from)) continue
    const to = join(reviveDir(folder), bucket, stamp, rel)
    await mkdir(dirname(to), { recursive: true })
    await rename(from, to)
    moved.push(rel)
  }
  return moved
}
