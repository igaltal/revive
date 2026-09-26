import type { ScanError } from '@shared/scan'

export interface AgentScanEvent {
  kind: 'read' | 'glob'
  /** Relative to the scanned folder. */
  path?: string
}

export type AgentScanResult =
  | { ok: true; costUsd: number | null }
  | { ok: false; code: Exclude<ScanError['code'], 'modified_outside' | 'invalid_manifest' | 'version_failed'>; costUsd: number | null; detail?: string[] }

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
  // fix?(folder: string, projectId: string, log: string, opts: …): Promise<…>     (Phase 2)
  // change?(folder: string, projectId: string, request: string, opts: …): Promise<…> (Phase 2)
}
