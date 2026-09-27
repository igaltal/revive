import { existsSync } from 'node:fs'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isSafeId, parseShotPath, shotPath } from '@shared/assets'

export const shotsDir = (folder: string) => join(folder, '.revive', 'shots')

export function shotFile(folder: string, projectId: string): string | null {
  return isSafeId(projectId) ? join(shotsDir(folder), `${projectId}.png`) : null
}

export async function saveShot(folder: string, projectId: string, png: Buffer): Promise<string | null> {
  const file = shotFile(folder, projectId)
  if (!file || png.length === 0) return null
  await mkdir(shotsDir(folder), { recursive: true })
  await writeFile(`${file}.tmp`, png)
  await rename(`${file}.tmp`, file)
  return shotPath(projectId, (await stat(file)).mtimeMs)
}

/** Asset paths for every project that has a picture. */
export async function listShots(folder: string, projectIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const id of projectIds) {
    const file = shotFile(folder, id)
    if (file && existsSync(file)) out[id] = shotPath(id, (await stat(file)).mtimeMs)
  }
  return out
}

/**
 * Maps a request path to a file, or null. Only `/shots/<id>.png` for a
 * project in the current manifest, and only inside `.revive/shots/`.
 * Used by the desktop protocol and, later, by an HTTP server.
 */
export function resolveAssetRequest(folder: string, pathname: string, projectIds: ReadonlySet<string>): string | null {
  const id = parseShotPath(pathname)
  if (!id || !projectIds.has(id)) return null
  const file = shotFile(folder, id)
  return file && existsSync(file) ? file : null
}
