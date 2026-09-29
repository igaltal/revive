import { existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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

/** Removes an index lock older than ten minutes: no save takes that long, so its owner is gone. */
export async function clearStaleLock(env: GitEnv): Promise<boolean> {
  const index = env.indexFile ?? (env.gitDir ? join(env.gitDir, 'index') : null)
  if (!index) return false
  const lock = `${index}.lock`
  try {
    const s = await stat(lock)
    if (Date.now() - s.mtimeMs < 10 * 60_000) return false
    await rm(lock, { force: true })
    return true
  } catch {
    return false
  }
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
  // Too big to keep, or only in iCloud (git would download it to read it): left out of versions.
  const bigFiles = files.filter((f) => f.size > MAX_FILE_BYTES || f.cloud).map((f) => f.rel)
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
  const id = newId()
  const parts = await snapshotParts(folder, `Revive: ${title.en}\n\nrevive-version: ${id}\nkind: ${kind}\n`)
  for (const part of parts) {
    const g = git(partEnv(folder, part))
    await g.raw(['update-ref', `refs/revive/versions/${id}`, part.commit])
    await g.raw(['update-ref', 'refs/revive/latest', part.commit])
  }
  const record: VersionRecord = { id, title, kind, createdAt: new Date().toISOString(), parts, ...extra }
  await appendVersion(folder, record)
  return record
}

/**
 * Snapshots the folder as it is now, one commit per repository, without
 * recording a version or moving any ref. Used to compare "now" with a saved
 * version before the user decides.
 */
export async function snapshotParts(folder: string, message = 'Revive: comparison\n'): Promise<VersionPart[]> {
  await ensureReviveDir(folder)
  const { parts: found, bigFiles } = await discoverParts(folder)
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

    // A lock left by an interrupted save (Revive quit or crashed mid-way) would block every save after it.
    await clearStaleLock(env)
    // Through a file: a big folder can have more exclusions than a command line holds.
    const specFile = join(reviveDir(folder), `pathspec-${process.pid}.txt`)
    await writeFile(specFile, pathspecs.join('\0'))
    try {
      await g.raw(['add', '--all', '--ignore-errors', `--pathspec-from-file=${specFile}`, '--pathspec-file-nul'])
    } finally {
      await rm(specFile, { force: true })
    }
    const tree = await g.raw(['write-tree'])
    const parent = (await g.raw(['rev-parse', '--quiet', '--verify', 'refs/revive/latest']).catch(() => '')).trim()
    const commitArgs = ['commit-tree', '--no-gpg-sign', tree.trim(), ...(parent ? ['-p', parent] : []), '-m', message]
    const commit = (await g.raw(commitArgs)).trim()
    parts.push({ ...part, commit })
  }
  return parts
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

export interface RestorePlan {
  /** Files to write back from the target version (changed, or gone since). */
  write: string[]
  /** Files that exist now but not in the target version: moved to the trash, never deleted. */
  remove: string[]
  /** Repositories that appeared after the target version; left exactly as they are. */
  untouchedParts: string[]
}

const joinRel = (dir: string, p: string) => (dir === '.' ? p : `${dir}/${p}`)

/**
 * What bringing back `target` changes, compared with `current` (a version
 * saved just now). Both are Revive snapshots made with the same rules, so
 * keys, dependencies and ignored files can never show up here.
 */
export async function planRestore(folder: string, current: VersionRecord, target: VersionRecord): Promise<RestorePlan> {
  const plan: RestorePlan = { write: [], remove: [], untouchedParts: [] }
  for (const part of target.parts) {
    const g = git(partEnv(folder, part))
    const now = current.parts.find((p) => p.dir === part.dir && p.mode === part.mode)
    if (!now) {
      // The part isn't a repository any more (or not the same kind): write its files back, remove nothing.
      const listed = await g.raw(['ls-tree', '-r', '-z', '--name-only', part.commit])
      plan.write.push(...listed.split('\0').filter(Boolean).map((p) => joinRel(part.dir, p)))
      continue
    }
    if (now.commit === part.commit) continue
    const out = (await g.raw(['diff-tree', '-r', '-z', '--no-renames', '--name-status', now.commit, part.commit])).split('\0').filter(Boolean)
    for (let i = 0; i + 1 < out.length; i += 2) {
      const status = out[i]!
      const rel = joinRel(part.dir, out[i + 1]!)
      if (status === 'D') plan.remove.push(rel)
      else plan.write.push(rel)
    }
  }
  for (const p of current.parts) {
    if (!target.parts.some((t) => t.dir === p.dir && t.mode === p.mode)) plan.untouchedParts.push(p.dir)
  }
  return plan
}

/** What's in the trash: one folder per restore that moved files aside. */
export async function trashInfo(folder: string): Promise<{ items: number; bytes: number }> {
  const root = join(reviveDir(folder), 'trash')
  if (!existsSync(root)) return { items: 0, bytes: 0 }
  const { files } = await walkAll(root)
  return { items: files.length, bytes: files.reduce((n, f) => n + f.size, 0) }
}

/** Permanently removes .revive/trash. Only ever called after the user confirmed. */
export async function emptyTrash(folder: string): Promise<number> {
  const { items } = await trashInfo(folder)
  await rm(join(reviveDir(folder), 'trash'), { recursive: true, force: true })
  return items
}

/** Every file under a folder, including dependency-like names (the trash may hold anything). */
async function walkAll(root: string): Promise<{ files: Array<{ size: number }> }> {
  const files: Array<{ size: number }> = []
  const visit = async (dir: string) => {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const abs = join(dir, name)
      const st = await lstat(abs).catch(() => null)
      if (!st) continue
      if (st.isDirectory()) await visit(abs)
      else files.push({ size: st.size })
    }
  }
  await visit(root)
  return { files }
}
