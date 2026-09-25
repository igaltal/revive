import type { Settings, SettingsPatch } from './settings'
import type { HelpTopic, PrereqReport, TaskUpdate } from './prereq'
import type { FolderCheck, RecentFolder } from './folder'

/**
 * The single source of truth for renderer ↔ main communication.
 * The renderer never touches the filesystem or spawns processes; every
 * capability it has is listed here.
 */
export interface IpcRequests {
  'settings:get': { args: void; result: Settings }
  'settings:set': { args: SettingsPatch; result: Settings }
  'prereq:check': { args: void; result: PrereqReport }
  /** Runs the official installer. The renderer only calls this after the user confirmed. */
  'prereq:installClaude': { args: void; result: void }
  /** Starts `claude auth login` (opens the browser) and waits for sign-in. */
  'prereq:signIn': { args: void; result: void }
  'shell:openHelp': { args: { topic: HelpTopic }; result: void }
  'folder:pick': { args: void; result: FolderCheck | null }
  'folder:check': { args: { path: string }; result: FolderCheck }
  /** Validates, then remembers the folder as current and recent. */
  'folder:choose': { args: { path: string }; result: FolderCheck }
  'folder:recent': { args: void; result: RecentFolder[] }
  // M3: 'manifest:get', 'scan:start', 'scan:cancel'
  // M4: 'runner:*', 'preview:*', 'shots:url'
  // M5: 'versions:*', 'trash:*'
  // Later phases (reserved): 'fix:*', 'keys:*', 'golive:*', 'chat:*', 'nightshift:*'
}

export interface IpcEvents {
  'settings:changed': Settings
  'prereq:task': TaskUpdate
}

export type RequestChannel = keyof IpcRequests
export type EventChannel = keyof IpcEvents
export type RequestArgs<C extends RequestChannel> = IpcRequests[C]['args']
export type RequestResult<C extends RequestChannel> = IpcRequests[C]['result']

export const REQUEST_CHANNELS = [
  'settings:get',
  'settings:set',
  'prereq:check',
  'prereq:installClaude',
  'prereq:signIn',
  'shell:openHelp',
  'folder:pick',
  'folder:check',
  'folder:choose',
  'folder:recent'
] as const satisfies readonly RequestChannel[]
export const EVENT_CHANNELS = ['settings:changed', 'prereq:task'] as const satisfies readonly EventChannel[]

// Compile-time check that the runtime channel lists cover the whole contract.
type Missing<All, Listed> = Exclude<All, Listed>
const _allRequests: Missing<RequestChannel, (typeof REQUEST_CHANNELS)[number]> extends never ? true : never = true
const _allEvents: Missing<EventChannel, (typeof EVENT_CHANNELS)[number]> extends never ? true : never = true
void _allRequests
void _allEvents

export interface ReviveApi {
  invoke<C extends RequestChannel>(
    channel: C,
    ...args: RequestArgs<C> extends void ? [] : [RequestArgs<C>]
  ): Promise<RequestResult<C>>
  on<E extends EventChannel>(event: E, listener: (payload: IpcEvents[E]) => void): () => void
  /** Absolute path of a file or folder dropped onto the window. */
  pathForFile(file: File): string
}
