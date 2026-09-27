import type { ScanError } from '@shared/scan'

export interface AgentScanEvent {
  kind: 'read' | 'glob'
  /** Relative to the scanned folder. */
  path?: string
}

export type AgentFailureCode = Exclude<ScanError['code'], 'modified_outside' | 'invalid_manifest' | 'version_failed'>

export type AgentScanResult = { ok: true; costUsd: number | null } | { ok: false; code: AgentFailureCode; costUsd: number | null; detail?: string[] }

/** What the description step sees: only what indexing found, never the files. */
export interface DescribeInput {
  id: string
  name: string
  stack: string[]
  /** The indexing model's own English description, as a starting point. */
  draft: string
  notes: string[]
  /** Plain purposes of the keys the project uses (English). */
  keyPurposes: string[]
}

export interface Description {
  id: string
  en: string
  he: string
}

export type AgentDescribeResult = { ok: true; descriptions: Description[]; costUsd: number | null } | { ok: false; code: AgentFailureCode; costUsd: number | null; detail?: string[] }

export interface AgentScanOptions {
  model: string
  signal: AbortSignal
  onEvent: (e: AgentScanEvent) => void
}

/**
 * The seam between Revive and a coding agent. Phase 1 implements `scan` with
 * Claude Code. Later phases add `fix` (Fix it for me) and `change` (chat).
 */
export interface AgentAdapter {
  readonly id: 'claude' | 'codex' | 'fake'
  scan(folder: string, opts: AgentScanOptions): Promise<AgentScanResult>
  /** One short call, no tools: plain descriptions in English and Hebrew for every project. */
  describe(projects: DescribeInput[], opts: { model: string; signal: AbortSignal }): Promise<AgentDescribeResult>
  // fix?(folder: string, projectId: string, log: string, opts: …): Promise<…>     (Phase 2)
  // change?(folder: string, projectId: string, request: string, opts: …): Promise<…> (Phase 2)
}
