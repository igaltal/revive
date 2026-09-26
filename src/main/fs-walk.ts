import { lstat, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** Folders never worth walking: dependencies, caches and Revive's own folder. */
export const SKIP_DIRS = new Set(['node_modules', '.git', '.revive', '.venv', 'venv', '__pycache__', '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache'])

export interface WalkEntry {
  /** Path relative to the root, with forward slashes. */
  rel: string
  size: number
  mtimeMs: number
}

export interface WalkResult {
  files: WalkEntry[]
  /** Folders (relative) that hold their own git repository. */
  repos: string[]
}

/** Walks a folder without following symlinks. Unreadable entries are skipped, never fatal. */
export async function walk(root: string, opts: { maxFiles?: number } = {}): Promise<WalkResult> {
  const files: WalkEntry[] = []
  const repos: string[] = []
  const maxFiles = opts.maxFiles ?? 200_000
  const toRel = (abs: string) => relative(root, abs).split(sep).join('/')

  async function visit(dir: string): Promise<void> {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return
    }
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
        files.push({ rel: toRel(abs), size: st.size, mtimeMs: st.mtimeMs })
      }
    }
  }

  await visit(root)
  return { files, repos }
}
