import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { ASSET_HOST, ASSET_SCHEME } from '@shared/assets'
import { resolveAssetRequest } from './shots'
import { parsePhotoPath } from '@shared/appearance'

/** Must run before the app is ready. */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

/**
 * Serves `revive://local/shots/<id>.png` from the current folder's
 * `.revive/shots/`. The renderer never sees file paths.
 */
export function handleAssetProtocol(
  current: () => Promise<{ folder: string; projectIds: Set<string> } | null>,
  /** In client mode: the Host serves the picture (fetched here, with the device token). */
  remote?: () => ((path: string) => Promise<Response>) | null,
  /** This computer's own photos (backgrounds, screensaver). */
  photo?: (photoId: string) => string | null
): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const url = new URL(request.url)
    const fromHost = remote?.()
    if (fromHost && url.host === ASSET_HOST && request.method === 'GET') {
      const res = await fromHost(`${url.pathname}${url.search}`).catch(() => null)
      return res?.ok ? new Response(await res.arrayBuffer(), { headers: { 'content-type': res.headers.get('content-type') ?? 'image/png', 'cache-control': 'no-cache' } }) : new Response('Not found', { status: 404 })
    }
    const photoId = url.host === ASSET_HOST && request.method === 'GET' ? parsePhotoPath(url.pathname) : null
    if (photoId) {
      const file = photo?.(photoId) ?? null
      return file ? new Response(await readFile(file), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' } }) : new Response('Not found', { status: 404 })
    }
    const ctx = url.host === ASSET_HOST && request.method === 'GET' ? await current() : null
    const file = ctx ? resolveAssetRequest(ctx.folder, url.pathname, ctx.projectIds) : null
    if (!file) return new Response('Not found', { status: 404 })
    return new Response(await readFile(file), { headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' } })
  })
}
