import { existsSync } from 'node:fs'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LOCKABLE_FIELDS, manifestJsonSchema, parseManifest, type Manifest, type ParseResult, type Project } from '@shared/manifest'
import { redact } from '@shared/redact'

export const manifestPath = (folder: string) => join(folder, '.revive', 'manifest.json')
const backupPath = (folder: string) => join(folder, '.revive', 'manifest.previous.json')

/** Validated on every read. Missing file → null; unreadable → issues. */
export async function readManifest(folder: string): Promise<ParseResult | null> {
  const file = manifestPath(folder)
  if (!existsSync(file)) return null
  try {
    return parseManifest(JSON.parse(await readFile(file, 'utf8')))
  } catch (e) {
    return { ok: false, issues: [`not valid JSON: ${(e as Error).message}`] }
  }
}

export async function writeManifest(folder: string, manifest: Manifest): Promise<void> {
  const parsed = parseManifest(manifest)
  if (!parsed.ok) throw new Error(`Refusing to write an invalid manifest: ${parsed.issues.join('; ')}`)
  const tmp = `${manifestPath(folder)}.tmp`
  await writeFile(tmp, JSON.stringify(parsed.manifest, null, 2) + '\n')
  await rename(tmp, manifestPath(folder))
}

export async function writeSchema(folder: string): Promise<void> {
  await writeFile(join(folder, '.revive', 'schema.json'), JSON.stringify(manifestJsonSchema(), null, 2) + '\n')
}

/** Keeps the last good manifest, so a bad scan can never lose it. */
export async function backupManifest(folder: string): Promise<void> {
  if (existsSync(manifestPath(folder))) await copyFile(manifestPath(folder), backupPath(folder))
}

export async function restoreManifestBackup(folder: string): Promise<void> {
  if (existsSync(backupPath(folder))) await copyFile(backupPath(folder), manifestPath(folder))
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let o = obj
  for (const k of keys.slice(0, -1)) {
    if (!o[k] || typeof o[k] !== 'object') o[k] = {}
    o = o[k] as Record<string, unknown>
  }
  o[keys[keys.length - 1]!] = structuredClone(value)
}

function maskStrings<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T
  if (Array.isArray(value)) return value.map(maskStrings) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskStrings(v)])) as T
  }
  return value
}

/**
 * After a scan: Claude describes, Revive decides.
 * - Fields in user_locked keep the user's value, whatever the scan wrote.
 * - Status and verified_at belong to Revive. They carry over only if the run
 *   commands did not change; a scan can never claim a project works.
 * - "Running" is a live state and is never stored.
 * - Anything that looks like a secret is masked.
 * - scanned_at is the real time of the scan.
 */
export function mergeAfterScan(previous: Manifest | null, next: Manifest, now = new Date()): Manifest {
  const prevById = new Map(previous?.projects.map((p) => [p.id, p]) ?? [])
  const prevByPath = new Map(previous?.projects.map((p) => [p.path, p]) ?? [])

  const projects = next.projects.map((incoming): Project => {
    const prev = prevById.get(incoming.id) ?? prevByPath.get(incoming.path)
    const p = structuredClone(incoming) as Project
    const locked = new Set([...(prev?.user_locked ?? []), ...incoming.user_locked].filter((f) => (LOCKABLE_FIELDS as readonly string[]).includes(f)))

    if (prev) {
      for (const field of locked) setPath(p as unknown as Record<string, unknown>, field, getPath(prev, field))
    }
    p.user_locked = [...locked]

    const sameRecipe = prev && prev.run.install === p.run.install && prev.run.dev === p.run.dev
    if (sameRecipe && prev.status !== 'running') {
      p.status = prev.status
      p.run.verified_at = prev.run.verified_at
    } else {
      p.status = 'unknown'
      p.run.verified_at = null
    }
    return maskStrings(p)
  })

  // Revive records when it read the folder; Claude's own timestamp is not trusted.
  return maskStrings({ ...next, scanned_at: now.toISOString(), projects })
}
