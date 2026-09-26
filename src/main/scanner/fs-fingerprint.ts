import { walk, type WalkEntry } from '../fs-walk'

export type Fingerprint = Map<string, Pick<WalkEntry, 'size' | 'mtimeMs'>>

export interface FolderDiff {
  added: string[]
  removed: string[]
  modified: string[]
}

/** Every file outside .revive/ (and outside dependency folders), with size and time. */
export async function fingerprint(root: string): Promise<Fingerprint> {
  const { files } = await walk(root)
  return new Map(files.map((f) => [f.rel, { size: f.size, mtimeMs: f.mtimeMs }]))
}

export function diffFingerprints(before: Fingerprint, after: Fingerprint): FolderDiff {
  const added: string[] = []
  const removed: string[] = []
  const modified: string[] = []
  for (const [path, a] of after) {
    const b = before.get(path)
    if (!b) added.push(path)
    else if (b.size !== a.size || b.mtimeMs !== a.mtimeMs) modified.push(path)
  }
  for (const path of before.keys()) if (!after.has(path)) removed.push(path)
  return { added, removed, modified }
}

export function isClean(d: FolderDiff): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.modified.length === 0
}
