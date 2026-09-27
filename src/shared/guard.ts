/**
 * Revive only lets Claude Code read a folder if the installed version really
 * stops at the turn limit Revive sets. This is checked once per Claude Code
 * version with a tiny real run (see main/scanner/turn-limit-guard.ts).
 */
export type GuardState =
  | { state: 'checking'; version: string | null }
  | { state: 'ok'; version: string; checkedAt: string }
  /** The limit was ignored or the flag is unknown: scans are refused. */
  | { state: 'failed'; version: string | null; detail: string[] }
  /** Couldn't check (signed out, offline, not installed). Checked again before the next scan. */
  | { state: 'unchecked'; version: string | null; detail: string[] }
  /** The offline test agent is in use; there is no Claude to check. */
  | { state: 'skipped' }
