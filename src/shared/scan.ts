import type { Manifest } from './manifest'

/**
 * Reading a folder: save a version, find the projects (on this computer, no
 * AI), put the new or changed ones into plain words (Claude, no tools, a
 * summary only), check nothing else changed.
 */
export type ScanPhase = 'saving' | 'finding' | 'understanding' | 'checking' | 'done'

/** Each project's own progress through a reading. */
export type ScanProjectState = 'found' | 'waiting' | 'reading' | 'done' | 'unchanged' | 'failed'

export interface ScanProjectProgress {
  id: string
  name: string
  /** Relative to the chosen folder. */
  path: string
  state: ScanProjectState
  /** Files only in iCloud: not opened, not downloaded. */
  cloudOnly: number
}

export interface ScanProgress {
  scanId: string
  phase: ScanPhase
  /** Projects in the order they were found. */
  projects: ScanProjectProgress[]
  /** How many need Claude this time (new or changed); the rest are unchanged. */
  toUnderstand: number
  understood: number
  /** What Claude reported so far. */
  costUsd: number | null
  /** Before Claude starts: roughly what this reading will cost. */
  estimateUsd: number | null
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
  step: 'understand'
  model: string
  usd: number | null
}

/** A reading's outcome, for the one sentence after it. */
export interface ScanSummary {
  found: number
  /** Put into words this time. */
  understood: number
  /** Unchanged since last time: kept as they were, no cost. */
  unchanged: number
  /** Couldn't be put into words this time (kept what was known; tried again next time). */
  failed: string[]
  /** Projects with files only in iCloud (not opened). */
  withCloudOnly: number
  /** Folders skipped because they didn't answer in time. */
  slowFolders: number
}

/** `costUsd` is the total of all parts that reported a cost. */
export type ScanDone =
  | { scanId: string; ok: true; manifest: Manifest; costUsd: number | null; costParts: ScanCostPart[]; summary: ScanSummary }
  | { scanId: string; ok: false; error: ScanError; costUsd: number | null; costParts: ScanCostPart[] }

export function totalCost(parts: ScanCostPart[]): number | null {
  const known = parts.filter((p) => p.usd !== null)
  return known.length ? known.reduce((sum, p) => sum + p.usd!, 0) : null
}

/** Limits for each understanding call (a few projects, no tools). */
export const UNDERSTAND_LIMITS = { maxTurns: 3, maxBudgetUsd: 0.5, timeoutMs: 2 * 60_000 } as const
/** Projects per call, and calls at once. */
export const UNDERSTAND_BATCH = { size: 4, parallel: 3 } as const
/** Measured on real projects, thinking off (Sonnet about 2 cents each, Haiku about 1), for the estimate before a reading. */
export const COST_PER_PROJECT_USD: Record<string, number> = { haiku: 0.01, sonnet: 0.02, opus: 0.08 }

export function estimateCost(model: string, projects: number): number | null {
  const per = COST_PER_PROJECT_USD[model]
  return per === undefined || projects === 0 ? null : Math.round(per * projects * 100) / 100
}
