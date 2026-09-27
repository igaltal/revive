import type { Manifest } from './manifest'

export type ScanPhase = 'saving' | 'reading' | 'checking' | 'describing' | 'done'

export interface ScanProgress {
  scanId: string
  phase: ScanPhase
  filesRead: number
  /** Project folders found so far (relative), in order of discovery. */
  projectsFound: string[]
  /** The most recent files read (relative), newest last. */
  recent: string[]
}

export type ScanErrorCode =
  | 'version_failed'
  | 'claude_missing'
  | 'auth'
  | 'unsafe_claude'
  | 'modified_outside'
  | 'invalid_manifest'
  | 'limit'
  | 'timeout'
  | 'cancelled'
  | 'unknown'

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

/** What each Claude call in one reading cost, as Claude reported it. */
export interface ScanCostPart {
  step: 'index' | 'describe'
  model: string
  usd: number | null
}

/** `costUsd` is the total of all parts that reported a cost. */
export type ScanDone =
  | { scanId: string; ok: true; manifest: Manifest; costUsd: number | null; costParts: ScanCostPart[]; versionId: string }
  | { scanId: string; ok: false; error: ScanError; costUsd: number | null; costParts: ScanCostPart[] }

export function totalCost(parts: ScanCostPart[]): number | null {
  const known = parts.filter((p) => p.usd !== null)
  return known.length ? known.reduce((sum, p) => sum + p.usd!, 0) : null
}

/** Hard limits for one scan. */
export const SCAN_LIMITS = { maxTurns: 200, maxBudgetUsd: 3, timeoutMs: 10 * 60_000 } as const

/**
 * After indexing, one short call writes the plain descriptions. It has no
 * tools at all: it sees only what indexing found and answers in JSON.
 */
export const DESCRIBE_MODEL = 'sonnet'
export const DESCRIBE_LIMITS = { maxTurns: 3, maxBudgetUsd: 0.5, timeoutMs: 2 * 60_000 } as const

/** Files that mark the root of a project (from the scan prompt). */
export const PROJECT_MARKERS = ['package.json', 'pyproject.toml', 'requirements.txt', 'Dockerfile', 'index.html'] as const
