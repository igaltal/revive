import type { SessionRef } from '@shared/runtime'

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
  onData(listener: (data: string) => void): () => void
  /** Called once. If the session already exited, called right away. */
  onExit(listener: (exit: SessionExit) => void): () => void
}

/**
 * Creates terminal sessions. M4 ships a direct node-pty backend; a tmux
 * backend (sessions that outlive Revive and can be attached from elsewhere)
 * can implement the same interface later.
 */
export interface SessionBackend {
  readonly kind: 'pty'
  spawn(spec: SessionSpec): SessionHandle
}
