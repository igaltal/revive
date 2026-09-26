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
