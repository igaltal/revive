/**
 * Runner and terminal activity, as one typed event stream.
 *
 * Main emits these; any client (the renderer today, a remote Revive Host
 * client later) subscribes to the same stream. Clients never see process ids
 * or file descriptors: a session is known only by its stable identity, so
 * the process behind it may live anywhere.
 */

/** Who a terminal session belongs to. `shell` runs the project's own commands (install, dev). */
export const SESSION_AGENTS = ['shell', 'claude', 'codex'] as const
export type SessionAgent = (typeof SESSION_AGENTS)[number]

/** Stable identity of a terminal session: one per project and agent. */
export interface SessionRef {
  projectId: string
  agent: SessionAgent
}

export type SessionKey = `${string}:${SessionAgent}`
export const sessionKey = (ref: SessionRef): SessionKey => `${ref.projectId}:${ref.agent}`

/** What a session is running right now, for the runner's own bookkeeping. */
export type RunStep = 'install' | 'dev' | 'serve'

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
  /** The command being run, for Technical details. */
  command: string | null
  updatedAt: string
}

type RuntimeEventBody =
  | { type: 'process.started'; session: SessionRef; step: RunStep; command: string; backend: string }
  /** Terminal output, secrets already masked. May contain terminal colour codes. */
  | { type: 'process.output'; session: SessionRef; data: string }
  | { type: 'port.detected'; projectId: string; port: number; url: string; source: 'output' | 'probe' }
  | { type: 'status.changed'; state: RunState }
  | { type: 'process.exited'; session: SessionRef; step: RunStep; exitCode: number | null; signal: string | null }
  /** A new picture of the project; `path` is served by the asset protocol (see shared/assets). */
  | { type: 'shot.captured'; projectId: string; path: string }
  /** The manifest on disk changed (status, verified time, URL and port). */
  | { type: 'manifest.changed' }

/** Every event carries a sequence number so a client that reconnects can ask for what it missed. */
export type RuntimeEvent = RuntimeEventBody & { seq: number; at: string }
export type RuntimeEventInput = RuntimeEventBody
export type RuntimeEventType = RuntimeEvent['type']
