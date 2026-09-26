import type { Manifest } from './manifest'

export type ScanPhase = 'saving' | 'reading' | 'checking' | 'done'

export interface ScanProgress {
  scanId: string
  phase: ScanPhase
  filesRead: number
  /** Project folders found so far (relative), in order of discovery. */
  projectsFound: string[]
  /** The most recent files read (relative), newest last. */
  recent: string[]
}

export type ScanErrorCode = 'version_failed' | 'claude_missing' | 'auth' | 'modified_outside' | 'invalid_manifest' | 'limit' | 'timeout' | 'cancelled' | 'unknown'

export interface ScanError {
  code: ScanErrorCode
  /** Files put back from the saved version. */
  restored?: string[]
  /** New files moved to .revive/quarantine/. */
  quarantined?: string[]
  /** Changed files that could not be put back (not in the saved version). */
  unrestorable?: string[]
  /** Validation problems or a short masked log, for Technical details. */
  detail?: string[]
}

export type ScanDone =
  | { scanId: string; ok: true; manifest: Manifest; costUsd: number | null; versionId: string }
  | { scanId: string; ok: false; error: ScanError; costUsd: number | null }

/** Hard limits for one scan. */
export const SCAN_LIMITS = { maxTurns: 200, maxBudgetUsd: 3, timeoutMs: 10 * 60_000 } as const

/** Files that mark the root of a project (from the scan prompt). */
export const PROJECT_MARKERS = ['package.json', 'pyproject.toml', 'requirements.txt', 'Dockerfile', 'index.html'] as const
