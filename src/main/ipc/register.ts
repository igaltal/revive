import { ipcMain, type BrowserWindow } from 'electron'
import type { IpcEvents, EventChannel, RequestArgs, RequestChannel, RequestResult } from '@shared/ipc'
import type { SettingsStore } from '../settings-store'

type Handler<C extends RequestChannel> = (args: RequestArgs<C>) => RequestResult<C> | Promise<RequestResult<C>>

function handle<C extends RequestChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, (_event, args: RequestArgs<C>) => handler(args))
}

export function send<E extends EventChannel>(win: BrowserWindow | null, event: E, payload: IpcEvents[E]): void {
  if (win && !win.isDestroyed()) win.webContents.send(event, payload)
}

export function registerIpc(deps: { settings: SettingsStore; getWindow: () => BrowserWindow | null }): void {
  handle('settings:get', () => deps.settings.get())
  handle('settings:set', (patch) => {
    const next = deps.settings.update(patch)
    send(deps.getWindow(), 'settings:changed', next)
    return next
  })
}

