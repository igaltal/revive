export type FolderProblem = 'missing' | 'not-directory' | 'too-broad' | 'unreadable'

export type FolderCheck = { ok: true; path: string; name: string } | { ok: false; path: string; problem: FolderProblem }

export interface RecentFolder {
  path: string
  name: string
  exists: boolean
}
