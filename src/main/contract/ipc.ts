import type { IpcMain, WebContents } from 'electron'
import { CLIENT_STREAMS, METHOD_NAMES } from '@shared/contract-names'
import type { SessionHub } from '../services/sessions/session-hub'
import type { CallEnvelope } from '@shared/transport'
import { ContractError, dispatch, handleClientStream, type Handlers } from './dispatch'
import type { ServerStreams } from './streams'

/**
 * Electron IPC, generated from the contract registry: one ipcMain.handle per
 * method, one ipcMain.on per client stream, and every server stream sent to
 * the window. Nothing else in main registers IPC (a test checks this).
 */
export function registerIpc(opts: {
  ipcMain: Pick<IpcMain, 'handle' | 'on'>
  handlers: Handlers
  streams: ServerStreams
  hub: SessionHub
  /** The window to send streams to; null while there is none. */
  target: () => Pick<WebContents, 'send' | 'isDestroyed'> | null
  checkOutputs: boolean
}): void {
  for (const name of METHOD_NAMES) {
    opts.ipcMain.handle(name, (_event, raw: unknown): Promise<CallEnvelope> =>
      dispatch(opts.handlers, name, raw, { transport: 'ipc' }, opts.checkOutputs).then(
        (v) => ({ ok: true, v }),
        (e: unknown) => ({ ok: false, e: { code: e instanceof ContractError ? e.code : 'failed', message: String((e as Error)?.message ?? e) } })
      )
    )
  }
  for (const stream of CLIENT_STREAMS) {
    opts.ipcMain.on(stream, (_event, raw: unknown) => void handleClientStream(opts.hub, stream, raw))
  }
  opts.streams.subscribe((stream, payload) => {
    const t = opts.target()
    if (t && !t.isDestroyed()) t.send(stream, payload)
  })
}
