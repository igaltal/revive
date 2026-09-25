import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, REQUEST_CHANNELS, type ReviveApi } from '../shared/ipc'

const requests = new Set<string>(REQUEST_CHANNELS)
const events = new Set<string>(EVENT_CHANNELS)

const api: ReviveApi = {
  invoke: (channel, ...args) => {
    if (!requests.has(channel)) return Promise.reject(new Error(`Unknown channel: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (event, listener) => {
    if (!events.has(event)) throw new Error(`Unknown event: ${event}`)
    const wrapped = (_e: IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  }
}

contextBridge.exposeInMainWorld('revive', api)
