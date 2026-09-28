import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { CLIENT_STREAMS, METHOD_NAMES, SERVER_STREAMS } from '../shared/contract-names'
import type { DesktopBridge } from '../shared/transport'

// Only names in the contract registry pass; everything else is refused here too.
const methods = new Set<string>(METHOD_NAMES)
const serverStreams = new Set<string>(SERVER_STREAMS)
const clientStreams = new Set<string>(CLIENT_STREAMS)

const bridge: DesktopBridge = {
  invoke: (method, input) => {
    if (!methods.has(method)) return Promise.reject(new Error(`Unknown method: ${method}`))
    return ipcRenderer.invoke(method, input)
  },
  on: (stream, listener) => {
    if (!serverStreams.has(stream)) throw new Error(`Unknown stream: ${stream}`)
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(stream, wrapped)
    return () => ipcRenderer.removeListener(stream, wrapped)
  },
  send: (stream, payload) => {
    if (clientStreams.has(stream)) ipcRenderer.send(stream, payload)
  },
  pathForFile: (file) => webUtils.getPathForFile(file as File)
}

contextBridge.exposeInMainWorld('revive', bridge)
