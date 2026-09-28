import { HELP_PAGES } from '@shared/prereq'
import { sessionId as toSessionId, parseSessionId } from '@shared/runtime'
import type { GuardState } from '@shared/guard'
import type { Bounds } from '@shared/contract'
import type { SettingsStore } from '../settings-store'
import { exec } from '../exec'
import { checkPrereqs } from '../prereq'
import { installClaude, signIn } from '../tasks'
import { checkFolder, describeRecent } from '../folders'
import { readManifest } from '../manifest-store'
import type { ScanController } from '../scanner/controller'
import type { Workspace } from '../services/workspace'
import type { Runner } from '../services/runner/runner'
import type { RuntimeBus } from '../services/runtime-bus'
import type { SessionHub } from '../services/sessions/session-hub'
import type { VersionService } from '../services/versions/version-service'
import { listShots } from '../services/shots/shots'
import type { Handlers } from './dispatch'
import type { ServerStreams } from './streams'

/** What only the desktop app can do. Tests and headless setups pass a stand-in. */
export interface Platform {
  pickFolder(defaultPath: string | undefined): Promise<string | null>
  openExternal(url: string): Promise<void>
  preview: {
    show(projectId: string, bounds: Bounds, device: 'desktop' | 'phone'): void
    hide(): void
    cover(): Promise<void>
    uncover(): void
    reload(): void
    openInBrowser(projectId: string): Promise<void>
  }
}

export interface Core {
  settings: SettingsStore
  /** Resolves once the login-shell PATH is loaded. */
  shellReady: Promise<void>
  scans: ScanController
  workspace: Workspace
  runner: Runner
  bus: RuntimeBus
  hub: SessionHub
  versions: VersionService
  streams: ServerStreams
  guard: { current: () => GuardState; recheck: () => Promise<GuardState> }
}

/**
 * Every contract method, as one call into a service. Inputs arrive already
 * validated by dispatch(); nothing here decides anything a service should.
 */
export function createHandlers(core: Core, platform: Platform): Handlers {
  const { settings, workspace, runner, versions, streams } = core
  const notifySettings = () => streams.emit('settings:changed', settings.get())

  return {
    'settings:get': () => settings.get(),
    'settings:set': (patch) => {
      const next = settings.update(patch)
      notifySettings()
      return next
    },

    'prereq:check': async () => {
      await core.shellReady
      return checkPrereqs(exec)
    },
    'prereq:installClaude': async () => {
      await core.shellReady
      installClaude((u) => streams.emit('prereq:task', u))
    },
    'prereq:signIn': async () => {
      await core.shellReady
      signIn((u) => streams.emit('prereq:task', u))
    },
    'shell:openHelp': ({ topic }) => platform.openExternal(HELP_PAGES[topic]),

    'folder:pick': async () => {
      const picked = await platform.pickFolder(settings.get().lastFolder ?? undefined)
      return picked ? checkFolder(picked) : null
    },
    'folder:check': ({ path }) => checkFolder(path),
    'folder:choose': async ({ path }) => {
      const check = await workspace.choose(path)
      if (check.ok) notifySettings()
      return check
    },
    'folder:recent': () => describeRecent(settings.get().recentFolders),

    'manifest:get': async () => {
      const r = await readManifest(await workspace.current())
      if (!r) return { state: 'none' as const }
      return r.ok ? { state: 'ok' as const, manifest: r.manifest } : { state: 'invalid' as const, issues: r.issues }
    },
    // The client never names a folder to scan: it is always the one the user chose.
    'scan:start': async () => {
      await core.shellReady
      return core.scans.start(await workspace.current(), settings.get().scanModel)
    },
    'scan:cancel': ({ scanId }) => core.scans.cancel(scanId),
    'scan:active': () => {
      const a = core.scans.active()
      return a ? { scanId: a.scanId } : null
    },
    'guard:status': () => core.guard.current(),
    'guard:recheck': () => core.guard.recheck(),

    'runner:start': ({ projectId }) => runner.start(projectId),
    'runner:stop': ({ projectId }) => runner.stop(projectId),
    'runner:list': () => runner.list(),
    'runner:logs': ({ projectId }) => runner.logs(projectId),
    'runtime:head': () => ({ seq: core.bus.lastSeq }),
    'runtime:since': ({ seq }) => core.bus.since(seq),
    'sessions:output': ({ sessionId, fromOffset }) => core.hub.output(toSessionId(parseSessionId(sessionId)!), fromOffset),

    'preview:show': ({ projectId, bounds, device }) => platform.preview.show(projectId, bounds, device),
    'preview:hide': () => platform.preview.hide(),
    'preview:cover': () => platform.preview.cover(),
    'preview:uncover': () => platform.preview.uncover(),
    'preview:reload': () => platform.preview.reload(),
    'preview:openInBrowser': ({ projectId }) => platform.preview.openInBrowser(projectId),

    'shots:list': async () => {
      const ctx = await workspace.projectIds()
      return ctx ? listShots(ctx.folder, [...ctx.projectIds]) : {}
    },

    // The version service checks its own inputs too, whichever way they arrive.
    'versions:list': () => versions.list(),
    'versions:save': () => versions.save(),
    'versions:preview': (input) => versions.preview(input),
    'versions:restore': (input) => versions.restore(input),
    'versions:undo': (input) => versions.undo(input),
    'trash:info': () => versions.trash(),
    'trash:empty': (input) => versions.emptyTrash(input)
  }
}
