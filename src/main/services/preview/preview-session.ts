import { session, shell, type Session, type WebContents } from 'electron'

/** Project pages run in their own session: no access to Revive's storage, no permissions. */
export const PREVIEW_PARTITION = 'revive-preview'

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i
export const isLocalUrl = (url: string) => LOCAL.test(url)

let configured: Session | null = null

export function previewSession(): Session {
  if (configured) return configured
  const s = session.fromPartition(PREVIEW_PARTITION)
  s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  s.setPermissionCheckHandler(() => false)
  configured = s
  return s
}

/**
 * The preview may only show this computer's servers. Links elsewhere open in
 * the user's browser instead; the app itself can still load whatever it needs.
 */
export function guardPreviewContents(wc: WebContents): void {
  const openOutside = (url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  }
  wc.on('will-navigate', (event, url) => {
    if (isLocalUrl(url)) return
    event.preventDefault()
    openOutside(url)
  })
  wc.on('will-redirect', (event, url) => {
    if (!isLocalUrl(url)) event.preventDefault()
  })
  wc.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
}
