import type { Settings, SettingsPatch } from './settings'

/**
 * The single source of truth for renderer ↔ main communication.
 * The renderer never touches the filesystem or spawns processes; every
 * capability it has is listed here.
 */
export interface IpcRequests {
  'settings:get': { args: void; result: Settings }
  'settings:set': { args: SettingsPatch; result: Settings }
  // M2: 'prereq:check', 'folder:pick', 'folder:open'
  // M3: 'manifest:get', 'scan:start', 'scan:cancel'
  // M4: 'runner:*', 'preview:*', 'shots:url'
  // M5: 'versions:*', 'trash:*'
  // Later phases (reserved): 'fix:*', 'keys:*', 'golive:*', 'chat:*', 'nightshift:*'
}

export interface IpcEvents {
  'settings:changed': Settings
}

export type RequestChannel = keyof IpcRequests
export type EventChannel = keyof IpcEvents
export type RequestArgs<C extends RequestChannel> = IpcRequests[C]['args']
export type RequestResult<C extends RequestChannel> = IpcRequests[C]['result']

export const REQUEST_CHANNELS = ['settings:get', 'settings:set'] as const satisfies readonly RequestChannel[]
export const EVENT_CHANNELS = ['settings:changed'] as const satisfies readonly EventChannel[]

export interface ReviveApi {
  invoke<C extends RequestChannel>(
    channel: C,
    ...args: RequestArgs<C> extends void ? [] : [RequestArgs<C>]
  ): Promise<RequestResult<C>>
  on<E extends EventChannel>(event: E, listener: (payload: IpcEvents[E]) => void): () => void
}
