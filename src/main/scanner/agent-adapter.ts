import type { ScanError } from '@shared/scan'
import type { ProjectDigest } from './detect'

export type AgentFailureCode = Exclude<ScanError['code'], 'modified_outside' | 'invalid_manifest' | 'version_failed'>

/** What the understanding step sees for one project: a summary Revive made, never the files. */
export interface UnderstandInput {
  id: string
  path: string
  stack: string[]
  commands: { install: string | null; dev: string | null }
  digest: ProjectDigest
}

export interface Understanding {
  id: string
  name: string
  en: string
  he: string
  keys: Array<{ key: string; en: string; he: string }>
  notes: string[]
}

export type AgentUnderstandResult = { ok: true; projects: Understanding[]; costUsd: number | null } | { ok: false; code: AgentFailureCode; costUsd: number | null; detail?: string[] }

/**
 * The seam between Revive and a coding agent. Revive finds the projects and
 * what their files say on its own (scanner/detect.ts); the agent only turns a
 * summary into plain words. Later phases add `fix` (Fix it for me) and
 * `change` (chat).
 */
export interface AgentAdapter {
  readonly id: 'claude' | 'codex' | 'fake'
  /** Before any call: the agent is installed, signed in and safe to use. */
  ready(): Promise<{ ok: true } | { ok: false; code: AgentFailureCode; detail?: string[] }>
  /** One short call, no tools, no files: names, descriptions, key purposes and notes for a few projects. */
  understand(projects: UnderstandInput[], opts: { model: string; signal: AbortSignal }): Promise<AgentUnderstandResult>
}
