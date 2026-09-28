import type { Transport } from '@shared/transport'
import { IpcTransport } from './ipc-transport'

/**
 * The renderer's only door to the rest of Revive. Screens import `transport`
 * and see only the Transport interface; which implementation is behind it
 * (IPC on the desktop, a WebSocket in a browser later) is decided here.
 * A lint rule and a test keep every other renderer file away from Electron
 * and `window.revive`.
 */
let installed: Transport | null = null
let desktop: IpcTransport | null = null

function current(): Transport {
  if (installed) return installed
  // Re-created if the bridge is replaced (component tests install a fresh one per test).
  if (!desktop || desktop.bridge !== window.revive) desktop = new IpcTransport(window.revive)
  return desktop
}

/** For clients that aren't the desktop app (a browser client, tests). */
export function installTransport(t: Transport | null): void {
  installed = t
}

export const transport: Transport = {
  get kind() {
    return current().kind
  },
  invoke: ((method: string, input?: unknown) => (current().invoke as (m: string, i?: unknown) => Promise<unknown>)(method, input)) as Transport['invoke'],
  subscribe: ((stream: string, handler: unknown, from?: unknown) =>
    (current().subscribe as (s: string, h: unknown, f?: unknown) => () => void)(stream, handler, from)) as Transport['subscribe'],
  writeSession: (id, data) => current().writeSession(id, data),
  resizeSession: (id, cols, rows) => current().resizeSession(id, cols, rows),
  assetUrl: (path) => current().assetUrl(path),
  capabilities: () => current().capabilities(),
  onConnection: (handler) => current().onConnection(handler),
  pathForFile: (file) => {
    const t = current()
    if (!t.pathForFile) throw new Error('This client cannot read dropped files')
    return t.pathForFile(file)
  }
}
