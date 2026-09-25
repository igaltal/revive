import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, parse, resolve } from 'node:path'
import type { FolderCheck, RecentFolder } from '@shared/folder'

export const MAX_RECENT = 8

const SYSTEM_DIRS = ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/var', '/private', '/opt', '/Volumes', '/Users']

/** Folders too big or too sensitive to read as "a folder of projects". */
export function isTooBroad(path: string, home = homedir()): boolean {
  const p = resolve(path)
  const library = resolve(home, 'Library')
  return (
    p === parse(p).root ||
    p === resolve(home) ||
    SYSTEM_DIRS.includes(p) ||
    p === library ||
    p.startsWith(library + '/')
  )
}

export async function checkFolder(input: string, home = homedir()): Promise<FolderCheck> {
  const requested = resolve(input)
  let path: string
  try {
    path = await realpath(requested)
  } catch {
    return { ok: false, path: requested, problem: 'missing' }
  }
  try {
    if (!(await stat(path)).isDirectory()) return { ok: false, path, problem: 'not-directory' }
    await access(path, constants.R_OK | constants.X_OK)
  } catch {
    return { ok: false, path, problem: 'unreadable' }
  }
  if (isTooBroad(path, home)) return { ok: false, path, problem: 'too-broad' }
  return { ok: true, path, name: basename(path) }
}

export function addRecent(list: readonly string[], path: string): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, MAX_RECENT)
}

export async function describeRecent(list: readonly string[]): Promise<RecentFolder[]> {
  return Promise.all(
    list.map(async (path) => {
      const exists = await stat(path).then((s) => s.isDirectory(), () => false)
      return { path, name: basename(path), exists }
    })
  )
}
