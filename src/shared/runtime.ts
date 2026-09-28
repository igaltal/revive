import type { VersionSummary } from './versions'

/**
 * Runner, terminal and version activity, as one typed event stream.
 *
 * Main emits these; any client (the renderer today, a remote Revive Host
 * client later) subscribes to the same stream. Clients never see process ids
 * or file descriptors: a session is known only by its stable identity, so
 * the process behind it may live anywhere (a direct pty now, tmux later).
 *
 * Two families:
 * - State events change what a screen shows. They are numbered, and the last
 *   ones are kept so a client that reconnects can replay them (`since(seq)`).
 * - Output events carry terminal text. They are not numbered or replayed;
 *   the text lives in a per-session buffer read with `sessions:output`.
 */

/**
 * What a session is for. `run` holds a project's install and dev server
 * commands; `shell` is an interactive terminal; `claude` and `codex` are
 * agent terminals.
 */
export const SESSION_KINDS = ['run', 'shell', 'claude', 'codex'] as const
export type SessionKind = (typeof SESSION_KINDS)[number]

/** Stable identity of a session: one per project and kind. */
export interface SessionRef {
  projectId: string
  kind: SessionKind
}

/** The same identity as one string, `<projectId>:<kind>`, the same on every client. */
export type SessionId = `${string}:${SessionKind}`
export const sessionId = (ref: SessionRef): SessionId => `${ref.projectId}:${ref.kind}`

export function parseSessionId(id: string): SessionRef | null {
  const cut = id.lastIndexOf(':')
  if (cut <= 0) return null
  const kind = id.slice(cut + 1)
  return (SESSION_KINDS as readonly string[]).includes(kind) ? { projectId: id.slice(0, cut), kind: kind as SessionKind } : null
}

/** What a run session is running right now, for the runner's own bookkeeping. */
export type RunStep = 'install' | 'dev' | 'serve' | 'terminal'
export const RUN_STEPS = ['install', 'dev', 'serve', 'terminal'] as const satisfies readonly RunStep[]

export const RUN_STATUSES = ['idle', 'installing', 'starting', 'checking', 'running', 'stopping', 'stopped', 'broken'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** Busy states: something is happening and the user should wait. */
export const BUSY_STATUSES: readonly RunStatus[] = ['installing', 'starting', 'checking', 'stopping']

export type BrokenCode =
  | 'missing_key'
  | 'port_busy'
  | 'deps_missing'
  | 'tool_missing'
  | 'install_failed'
  | 'no_start_command'
  | 'exited'
  | 'timeout'
  | 'unknown'

export interface BrokenReason {
  code: BrokenCode
  /** missing_key: the variable name, so the UI can show its plain purpose. */
  key?: string
  /** tool_missing: the program that isn't installed (npm, python, …). */
  tool?: string
}

export interface RunState {
  projectId: string
  status: RunStatus
  /** Where the running app answers. Also stored in the manifest's run block. */
  url: string | null
  port: number | null
  reason: BrokenReason | null
  /** The command being run, masked, for Technical details. */
  command: string | null
  updatedAt: string
}

type StateEventBody =
  | { type: 'process.started'; session: SessionRef; step: RunStep; command: string; backend: string }
  | { type: 'port.detected'; projectId: string; port: number; url: string; source: 'output' | 'probe' }
  | { type: 'status.changed'; state: RunState }
  | { type: 'process.exited'; session: SessionRef; step: RunStep; exitCode: number | null; signal: string | null }
  /** A new picture of the project; `path` is served by the asset protocol (see shared/assets). */
  | { type: 'shot.captured'; projectId: string; path: string }
  /** The manifest on disk changed (status, verified time, URL and port, or a restore). */
  | { type: 'manifest.changed' }
  | { type: 'version.saved'; version: VersionSummary }
  /**
   * A saved version was brought back. `undoVersionId` is the version saved just
   * before, so the restore itself can be undone. `stoppedProjects` were running
   * and were stopped for it; clients offer to start them again.
   */
  | {
      type: 'version.restored'
      how: 'restore' | 'undo'
      versionId: string
      undoVersionId: string
      /** Set when only this project went back; absent for the whole folder. */
      projectId?: string
      changedFiles: number
      stoppedProjects: string[]
    }
  | { type: 'trash.emptied'; removedItems: number }

export type StateEventInput = StateEventBody
export type StateEvent = StateEventBody & { seq: number; at: string }

/**
 * Terminal output, secrets already masked; may contain colour codes.
 * `offset` is where `data` starts in the session's output buffer (bytes), so a
 * client can tell whether it missed anything and fetch it with `sessions:output`.
 */
export interface OutputEvent {
  type: 'process.output'
  session: SessionRef
  data: string
  offset: number
  /** The buffer's lifetime; offsets from another epoch don't apply. */
  epoch: string
  at: string
}

export type RuntimeEvent = StateEvent | OutputEvent
export type RuntimeEventType = RuntimeEvent['type']

/** The state events a reconnecting client replays. Output is not among them. */
export const STATE_EVENT_TYPES = [
  'process.started',
  'port.detected',
  'status.changed',
  'process.exited',
  'shot.captured',
  'manifest.changed',
  'version.saved',
  'version.restored',
  'trash.emptied'
] as const satisfies readonly StateEvent['type'][]

// Compile-time check: every state event type is listed above (a new one can't be forgotten).
const _allState: Exclude<StateEvent['type'], (typeof STATE_EVENT_TYPES)[number]> extends never ? true : never = true
void _allState

/** How much output each session keeps (the tail). */
export const SESSION_OUTPUT_BYTES = 256 * 1024

/** A slice of a session's output buffer. */
export interface SessionOutput {
  sessionId: SessionId
  /** The buffer's lifetime. A client holding offsets from another epoch starts over. */
  epoch: string
  data: string
  /** Where `data` starts. Later than asked for when older output was already dropped. */
  fromOffset: number
  /** Ask from here next time. */
  nextOffset: number
  /** True when output between the asked offset and `fromOffset` is gone. */
  truncated: boolean
}
