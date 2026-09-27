/**
 * Files Revive serves to clients (today: project pictures).
 *
 * Main hands out origin-relative paths like `/shots/habit-counter.png?v=…`.
 * Each transport turns a path into a URL: the desktop app through the
 * `revive://` protocol handled by main, a remote client over HTTP. The paths
 * are the same either way.
 */
export const ASSET_SCHEME = 'revive'
export const ASSET_HOST = 'local'
export const LOCAL_ASSET_ORIGIN = `${ASSET_SCHEME}://${ASSET_HOST}`

const SAFE_ID = /^[A-Za-z0-9._-]{1,80}$/

/** Project ids come from the manifest; only plain ones are used as file names. */
export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id) && id !== '.' && id !== '..'
}

export function shotPath(projectId: string, version: number): string {
  return `/shots/${encodeURIComponent(projectId)}.png?v=${Math.round(version)}`
}

/** `/shots/<id>.png` → the project id, or null for anything else. */
export function parseShotPath(pathname: string): string | null {
  const m = /^\/shots\/([^/]+)\.png$/.exec(pathname)
  if (!m) return null
  let id: string
  try {
    id = decodeURIComponent(m[1]!)
  } catch {
    return null
  }
  return isSafeId(id) ? id : null
}
