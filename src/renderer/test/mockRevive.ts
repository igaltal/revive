import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import type { MethodName, ServerStreamName, ServerStreamPayload } from '@shared/contract'
import type { DesktopBridge } from '@shared/transport'
import { capabilitiesFor } from '@shared/contract'
import type { HostStatus } from '@shared/host'

export const HOST_OFF: HostStatus = {
  sharing: false,
  port: null,
  hostName: 'Studio Mac',
  tailscale: { state: 'available', address: null },
  sleepMinutes: 0,
  tmux: true,
  startAtLogin: false,
  pairing: null,
  lockedUntil: null,
  requests: [],
  devices: []
}
import type { PrereqReport } from '@shared/prereq'

export const READY_REPORT: PrereqReport = {
  claude: { installed: true, version: '2.1.282', signedIn: 'yes' },
  git: { installed: true, version: '2.47.1' },
  node: { installed: true, version: '24.1.0' },
  codex: { installed: false, version: null },
  checkedAt: '2026-09-25T00:00:00.000Z'
}

type Handlers = Partial<Record<MethodName, (args: unknown) => unknown>>

/** In-memory stand-in for the preload bridge. */
export function installMockRevive(initial: Partial<Settings> = {}, handlers: Handlers = {}) {
  let settings: Settings = { ...DEFAULT_SETTINGS, ...initial }
  const listeners = new Map<string, Set<(p: unknown) => void>>()
  const calls: Array<{ channel: string; args: unknown }> = []

  const emit = <E extends ServerStreamName>(event: E, payload: ServerStreamPayload<E>) => {
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
    'manifest:get': () => ({ state: 'none' }),
    'scan:active': () => null,
    'scan:start': () => ({ scanId: 'scan-1' }),
    'runtime:head': () => ({ seq: 0 }),
    'client:status': () => ({ state: 'local', host: null, problem: null, capabilities: capabilitiesFor('ipc') }),
    'host:status': () => HOST_OFF,
    'host:activity': () => [],
    'sessions:output': (a) => ({ sessionId: (a as { sessionId: string }).sessionId, epoch: 'e1', data: '', fromOffset: 0, nextOffset: 0, truncated: false }),
    'sessions:info': () => ({ backend: 'tmux', persistent: true, tmuxVersion: '3.7c', orphans: [] }),
    'sessions:list': () => [],
    'guard:status': () => ({ state: 'ok', version: '2.1.283', checkedAt: '2026-09-27T00:00:00.000Z' }),
    'runner:list': () => [],
    'runner:logs': () => [],
    'shots:list': () => ({}),
    'versions:list': () => [],
    'trash:info': () => ({ items: 0, bytes: 0 }),
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

  const api: DesktopBridge = {
    invoke: async (channel: string, args?: unknown) => {
      calls.push({ channel, args })
      const h = handlers[channel as MethodName] ?? defaults[channel as MethodName]
      try {
        return { ok: true, v: h ? await h(args) : undefined }
      } catch (e) {
        return { ok: false, e: { code: 'failed', message: String((e as Error).message) } }
      }
    },
    on: (event: string, listener: (p: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
      return () => listeners.get(event)!.delete(listener)
    },
    send: (channel: string, args: unknown) => void calls.push({ channel, args }),
    pathForFile: (file) => `/dropped/${file.name}`
  }
  Object.defineProperty(window, 'revive', { value: api, configurable: true })
  return { settings: () => settings, emit, calls }
}
