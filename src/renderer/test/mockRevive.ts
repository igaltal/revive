import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import type { EventChannel, IpcEvents, RequestChannel, ReviveApi } from '@shared/ipc'
import type { PrereqReport } from '@shared/prereq'

export const READY_REPORT: PrereqReport = {
  claude: { installed: true, version: '2.1.282', signedIn: 'yes' },
  git: { installed: true, version: '2.47.1' },
  node: { installed: true, version: '24.1.0' },
  codex: { installed: false, version: null },
  checkedAt: '2026-09-25T00:00:00.000Z'
}

type Handlers = Partial<Record<RequestChannel, (args: unknown) => unknown>>

/** In-memory stand-in for the preload bridge. */
export function installMockRevive(initial: Partial<Settings> = {}, handlers: Handlers = {}) {
  let settings: Settings = { ...DEFAULT_SETTINGS, ...initial }
  const listeners = new Map<string, Set<(p: unknown) => void>>()
  const calls: Array<{ channel: string; args: unknown }> = []

  const emit = <E extends EventChannel>(event: E, payload: IpcEvents[E]) => {
    for (const l of listeners.get(event) ?? []) l(payload)
  }

  const defaults: Handlers = {
    'settings:get': () => settings,
    'settings:set': (patch) => {
      settings = { ...settings, ...(patch as Partial<Settings>) }
      return settings
    },
    'prereq:check': () => READY_REPORT,
    'folder:recent': () => [],
    'folder:check': (a) => {
      const path = (a as { path: string }).path
      return { ok: true, path, name: path.split('/').pop() }
    },
    'folder:choose': (a) => {
      const path = (a as { path: string }).path
      settings = { ...settings, lastFolder: path, recentFolders: [path, ...settings.recentFolders] }
      emit('settings:changed', settings)
      return { ok: true, path, name: path.split('/').pop() }
    }
  }

  const api: ReviveApi = {
    invoke: (async (channel: RequestChannel, args?: unknown) => {
      calls.push({ channel, args })
      const h = handlers[channel] ?? defaults[channel]
      if (!h) return undefined
      return h(args)
    }) as ReviveApi['invoke'],
    on: ((event: string, listener: (p: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
      return () => listeners.get(event)!.delete(listener)
    }) as ReviveApi['on'],
    pathForFile: (file) => `/dropped/${file.name}`
  }
  Object.defineProperty(window, 'revive', { value: api, configurable: true })
  return { settings: () => settings, emit, calls }
}
