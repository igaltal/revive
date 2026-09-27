import { LOCAL_ASSET_ORIGIN } from '@shared/assets'
import type { ReviveApi } from '@shared/ipc'

/**
 * The renderer's only door to the rest of Revive.
 *
 * Today it forwards to the preload bridge (Electron IPC). A remote client
 * (Revive Host) replaces this one module with a network transport that
 * speaks the same typed contract; no screen changes. A lint rule and a test
 * keep every other renderer file away from Electron and `window.revive`.
 */
export interface Transport extends ReviveApi {
  /** Turns an asset path from main (e.g. `/shots/x.png?v=1`) into a URL this client can load. */
  assetUrl(path: string): string
}

export const transport: Transport = {
  invoke: ((channel, ...args) => window.revive.invoke(channel, ...args)) as ReviveApi['invoke'],
  on: ((event, listener) => window.revive.on(event, listener)) as ReviveApi['on'],
  pathForFile: (file) => window.revive.pathForFile(file),
  assetUrl: (path) => `${LOCAL_ASSET_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}
