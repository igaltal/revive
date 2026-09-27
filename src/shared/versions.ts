export type VersionKind = 'scan' | 'restore' | 'undo' | 'manual'

/** One repository's share of a saved version. */
export interface VersionPart {
  /** Folder relative to the chosen folder; '.' is the folder itself. */
  dir: string
  /** 'user' = the person's own git repo (refs/revive/ only), 'shadow' = .revive/git. */
  mode: 'user' | 'shadow'
  commit: string
}

export interface VersionRecord {
  id: string
  title: { en: string; he: string }
  kind: VersionKind
  createdAt: string
  parts: VersionPart[]
  /** For restores: the version that was brought back. */
  restoredFrom?: string
}

/** What clients see of a saved version: no commits, no paths inside git. */
export interface VersionSummary {
  id: string
  title: { en: string; he: string }
  kind: VersionKind
  createdAt: string
  /** 'restore' and 'undo' versions: the version that was brought back right after this one was saved. */
  restoredFrom?: string
}

export function summarize(record: VersionRecord): VersionSummary {
  const { id, title, kind, createdAt, restoredFrom } = record
  return { id, title, kind, createdAt, ...(restoredFrom ? { restoredFrom } : {}) }
}

/** Version ids as Revive makes them: v-20260928T101500Z-ab12c */
export const VERSION_ID = /^v-\d{8}T\d{6}Z-[a-z0-9]{1,8}$/

/** What going back to a version would do, shown before the user confirms. */
export interface RestorePreview {
  versionId: string
  /** Files that will be put back the way they were. */
  changedFiles: number
  /** Files made since then, which will be moved to the trash. */
  newFiles: number
  /** A few of the paths, for Technical details. */
  sample: string[]
  /** Running projects that will be stopped first. */
  willStop: string[]
}

export type VersionFailure = 'busy' | 'not_found' | 'failed'

export type RestoreResult =
  | {
      ok: true
      versionId: string
      /** Saved just before; going back to it undoes this restore. */
      undoVersionId: string
      changedFiles: number
      movedToTrash: string[]
      /** Were running, stopped for the restore: offer to start them again. */
      stoppedProjects: string[]
      /** Projects whose folder isn't there any more after going back. */
      missingProjects: string[]
    }
  | { ok: false; code: VersionFailure; detail?: string }

export interface TrashInfo {
  items: number
  bytes: number
}
