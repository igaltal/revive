import type { RunStep, SessionRef } from '@shared/runtime'

export interface SessionSpec {
  ref: SessionRef
  cwd: string
  /** Run directly, never through a string the renderer built. */
  file: string
  args: string[]
  env: Record<string, string>
  cols?: number
  rows?: number
}

export interface SessionExit {
  exitCode: number | null
  signal: string | null
}

/** A live terminal session. Where its process lives is the backend's business. */
export interface SessionHandle {
  readonly ref: SessionRef
  write(data: string): void
  resize(cols: number, rows: number): void
  /** Stops the session and everything it started. Resolves once it has exited. */
  kill(): Promise<SessionExit>
  /**
   * Stops watching, leaving the session running (tmux). Backends whose
   * sessions can't outlive Revive stop them instead.
   */
  detach(): Promise<void>
  onData(listener: (data: string) => void): () => void
  /** Called once. If the session already exited, called right away. */
  onExit(listener: (exit: SessionExit) => void): () => void
}

/** A session left running by an earlier Revive (tmux only). */
export interface ExistingSession {
  /** The backend's own name for it (the tmux session name). */
  name: string
  /** Who it belongs to, or null if that can't be told any more. */
  ref: SessionRef | null
  step: RunStep | null
  /** What it runs, as shown in Technical details. */
  display: string | null
  createdAt: string | null
}

/**
 * Creates terminal sessions. The direct node-pty backend's sessions end with
 * Revive; the tmux backend's sessions outlive it and can be attached again.
 */
export interface SessionBackend {
  readonly kind: 'pty' | 'tmux'
  /** Sessions outlive Revive. */
  readonly persistent: boolean
  spawn(spec: SessionSpec): SessionHandle
  /** Sessions still running from an earlier Revive. */
  list(): Promise<ExistingSession[]>
  /** Attaches to one of them. Its history (scrollback, with colours) comes first, then live output. */
  attach(existing: ExistingSession & { ref: SessionRef }, size?: { cols: number; rows: number }): SessionHandle
  /** Ends a session nobody is attached to (after the user confirmed). */
  end(name: string): Promise<void>
}
