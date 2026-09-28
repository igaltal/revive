/** This app's own updates (the desktop app only; a browser client has none). */
export interface UpdateStatus {
  /** off: not a packaged build, or no update feed configured. */
  state: 'off' | 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  current: string
  /** The version being downloaded or ready. */
  version: string | null
  channel: 'latest' | 'beta'
  percent: number | null
}
