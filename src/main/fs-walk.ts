import { lstat, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** Folders never worth walking: dependencies, caches and Revive's own folder. */
export const SKIP_DIRS = new Set(['node_modules', '.git', '.revive', '.venv', 'venv', '__pycache__', '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache'])

export interface WalkEntry {
  /** Path relative to the root, with forward slashes. */
  rel: string
  size: number
  mtimeMs: number
  /** Offloaded to iCloud (a size, no data on this disk): opening it would download it. */
  cloud: boolean
}

export interface WalkResult {
  files: WalkEntry[]
  /** Folders (relative) that hold their own git repository. */
  repos: string[]
}

/** A folder that takes longer than this to list (offloaded to iCloud, a slow drive) is left out. */
const LIST_TIMEOUT_MS = 2000

async function listNames(dir: string): Promise<string[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const slow = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), LIST_TIMEOUT_MS)))
    return await Promise.race([readdir(dir), slow])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Walks a folder without following symlinks. Unreadable entries are skipped, never fatal. */
export async function walk(root: string, opts: { maxFiles?: number } = {}): Promise<WalkResult> {
  const files: WalkEntry[] = []
  const repos: string[] = []
  const maxFiles = opts.maxFiles ?? 200_000
  const toRel = (abs: string) => relative(root, abs).split(sep).join('/')

  async function visit(dir: string): Promise<void> {
    const names = await listNames(dir)
    if (!names) return
    if (dir !== root && names.includes('.git')) repos.push(toRel(dir))
    for (const name of names.sort()) {
      if (files.length >= maxFiles) return
      const abs = join(dir, name)
      let st
      try {
        st = await lstat(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) await visit(abs)
      } else if (st.isFile() || st.isSymbolicLink()) {
        files.push({ rel: toRel(abs), size: st.size, mtimeMs: st.mtimeMs, cloud: st.isFile() && st.size > 0 && st.blocks === 0 })
      }
    }
  }

  await visit(root)
  return { files, repos }
}
