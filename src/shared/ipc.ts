import type { Settings, SettingsPatch } from './settings'
import type { HelpTopic, PrereqReport, TaskUpdate } from './prereq'
import type { FolderCheck, RecentFolder } from './folder'
import type { Manifest } from './manifest'
import type { ScanDone, ScanProgress } from './scan'
import type { RunState, RuntimeEvent } from './runtime'
import type { GuardState } from './guard'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}
export type PreviewDevice = 'desktop' | 'phone'

export type ManifestState = { state: 'none' } | { state: 'ok'; manifest: Manifest } | { state: 'invalid'; issues: string[] }

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
  /** The manifest of the current folder, validated. */
  'manifest:get': { args: void; result: ManifestState }
  /** Reads the current folder. Returns the running scan if one is already going. */
  'scan:start': { args: void; result: { scanId: string } }
  'scan:cancel': { args: { scanId: string }; result: void }
  'scan:active': { args: void; result: { scanId: string } | null }
  /** Whether the installed Claude Code honours the turn limit. */
  'guard:status': { args: void; result: GuardState }
  'guard:recheck': { args: void; result: GuardState }

  // Runner: thin adapters over main/services/runner. Progress arrives on 'runtime:event'.
  'runner:start': { args: { projectId: string }; result: RunState }
  'runner:stop': { args: { projectId: string }; result: RunState }
  'runner:list': { args: void; result: RunState[] }
  /** The project's recent output, masked, colour codes removed. */
  'runner:logs': { args: { projectId: string }; result: string[] }
  /** Events after `seq`, for a client that (re)connects late. */
  'runtime:since': { args: { seq: number }; result: RuntimeEvent[] }

  // Preview of a running project, laid over the renderer at `bounds` (window coordinates).
  'preview:show': { args: { projectId: string; bounds: Bounds; device: PreviewDevice }; result: void }
  'preview:hide': { args: void; result: void }
  'preview:reload': { args: void; result: void }
  'preview:openInBrowser': { args: { projectId: string }; result: void }

  /** Picture paths (see shared/assets) by project id, for the current folder. */
  'shots:list': { args: void; result: Record<string, string> }
  // M5: 'versions:*', 'trash:*'
  // Later phases (reserved): 'fix:*', 'keys:*', 'golive:*', 'chat:*', 'nightshift:*'
}

export interface IpcEvents {
  'settings:changed': Settings
  'prereq:task': TaskUpdate
  'scan:progress': ScanProgress
  'scan:done': ScanDone
  'guard:changed': GuardState
  /** The one stream for runner and terminal activity. */
  'runtime:event': RuntimeEvent
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
  'folder:recent',
  'manifest:get',
  'scan:start',
  'scan:cancel',
  'scan:active',
  'guard:status',
  'guard:recheck',
  'runner:start',
  'runner:stop',
  'runner:list',
  'runner:logs',
  'runtime:since',
  'preview:show',
  'preview:hide',
  'preview:reload',
  'preview:openInBrowser',
  'shots:list'
] as const satisfies readonly RequestChannel[]
export const EVENT_CHANNELS = ['settings:changed', 'prereq:task', 'scan:progress', 'scan:done', 'guard:changed', 'runtime:event'] as const satisfies readonly EventChannel[]

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
