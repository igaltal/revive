import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { z } from 'zod'
import type { IpcEvents, EventChannel, RequestArgs, RequestChannel, RequestResult } from '@shared/ipc'
import { HELP_PAGES, type HelpTopic } from '@shared/prereq'
import type { SettingsStore } from '../settings-store'
import { exec } from '../exec'
import { checkPrereqs } from '../prereq'
import { installClaude, signIn } from '../tasks'
import { checkFolder, describeRecent } from '../folders'
import { readManifest } from '../manifest-store'
import type { ScanController } from '../scanner/controller'
import type { GuardState } from '@shared/guard'
import type { Workspace } from '../services/workspace'
import type { Runner } from '../services/runner/runner'
import type { RuntimeBus } from '../services/runtime-bus'
import type { SessionHub } from '../services/sessions/session-hub'
import { parseSessionId, type SessionId } from '@shared/runtime'
import type { PreviewManager } from '../services/preview/preview-manager'
import type { VersionService } from '../services/versions/version-service'
import { listShots } from '../services/shots/shots'

type Handler<C extends RequestChannel> = (args: RequestArgs<C>) => RequestResult<C> | Promise<RequestResult<C>>

function handle<C extends RequestChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, (_event, args: RequestArgs<C>) => handler(args))
}

export function send<E extends EventChannel>(win: BrowserWindow | null, event: E, payload: IpcEvents[E]): void {
  if (win && !win.isDestroyed()) win.webContents.send(event, payload)
}

const PathArg = z.object({ path: z.string().min(1).max(4096) })
const ProjectArg = z.object({ projectId: z.string().min(1).max(80) })
const SessionOutputArg = z.object({
  sessionId: z.string().max(120).refine((id) => parseSessionId(id) !== null, 'unknown session').transform((id) => id as SessionId),
  fromOffset: z.number().int().min(0)
})
const Px = z.number().finite().min(-10_000).max(100_000)
const PreviewArg = ProjectArg.extend({
  bounds: z.object({ x: Px, y: Px, width: Px.min(0), height: Px.min(0) }),
  device: z.enum(['desktop', 'phone'])
})
const HelpArg = z.object({ topic: z.enum(Object.keys(HELP_PAGES) as [HelpTopic, ...HelpTopic[]]) })

export function registerIpc(deps: {
  settings: SettingsStore
  getWindow: () => BrowserWindow | null
  /** Resolves once the login-shell PATH is loaded. */
  shellReady: Promise<void>
  scans: ScanController
  workspace: Workspace
  runner: Runner
  bus: RuntimeBus
  hub: SessionHub
  preview: PreviewManager
  versions: VersionService
  guard: { current: () => GuardState; recheck: () => Promise<GuardState> }
}): void {
  const { settings, getWindow, workspace, runner, preview } = deps
  const notifySettings = () => send(getWindow(), 'settings:changed', settings.get())

  handle('settings:get', () => settings.get())
  handle('settings:set', (patch) => {
    const next = settings.update(patch)
    notifySettings()
    return next
  })

  handle('prereq:check', async () => {
    await deps.shellReady
    return checkPrereqs(exec)
  })
  handle('prereq:installClaude', async () => {
    await deps.shellReady
    installClaude((u) => send(getWindow(), 'prereq:task', u))
  })
  handle('prereq:signIn', async () => {
    await deps.shellReady
    signIn((u) => send(getWindow(), 'prereq:task', u))
  })
  handle('shell:openHelp', async (args) => {
    const { topic } = HelpArg.parse(args)
    await shell.openExternal(HELP_PAGES[topic])
  })

  handle('folder:pick', async () => {
    const win = getWindow()
    const options = {
      properties: ['openDirectory' as const],
      defaultPath: settings.get().lastFolder ?? undefined
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    return checkFolder(picked)
  })
  handle('folder:check', (args) => checkFolder(PathArg.parse(args).path))
  handle('folder:choose', async (args) => {
    const check = await workspace.choose(PathArg.parse(args).path)
    if (check.ok) notifySettings()
    return check
  })
  handle('folder:recent', () => describeRecent(settings.get().recentFolders))

  // The renderer never names a folder to scan: it is always the one the user chose.
  const currentFolder = () => workspace.current()

  handle('manifest:get', async () => {
    const r = await readManifest(await currentFolder())
    if (!r) return { state: 'none' as const }
    return r.ok ? { state: 'ok' as const, manifest: r.manifest } : { state: 'invalid' as const, issues: r.issues }
  })
  handle('scan:start', async () => {
    await deps.shellReady
    return deps.scans.start(await currentFolder(), settings.get().scanModel)
  })
  handle('scan:cancel', (args) => deps.scans.cancel(z.object({ scanId: z.string() }).parse(args).scanId))
  handle('scan:active', () => {
    const a = deps.scans.active()
    return a ? { scanId: a.scanId } : null
  })

  handle('guard:status', () => deps.guard.current())
  handle('guard:recheck', () => deps.guard.recheck())

  // Runner: every handler is one call into the service.
  handle('runner:start', (args) => runner.start(ProjectArg.parse(args).projectId))
  handle('runner:stop', (args) => runner.stop(ProjectArg.parse(args).projectId))
  handle('runner:list', () => runner.list())
  handle('runner:logs', (args) => runner.logs(ProjectArg.parse(args).projectId))
  handle('runtime:since', (args) => deps.bus.since(z.object({ seq: z.number().int().min(0) }).parse(args).seq))
  handle('sessions:output', (args) => {
    const { sessionId, fromOffset } = SessionOutputArg.parse(args)
    return deps.hub.output(sessionId, fromOffset)
  })
  deps.bus.subscribe((event) => send(getWindow(), 'runtime:event', event))

  handle('preview:show', (args) => {
    const { projectId, bounds, device } = PreviewArg.parse(args)
    preview.show(projectId, bounds, device)
  })
  handle('preview:hide', () => preview.hide())
  handle('preview:cover', () => preview.cover())
  handle('preview:uncover', () => preview.uncover())
  handle('preview:reload', () => preview.reload())
  handle('preview:openInBrowser', (args) => preview.openInBrowser(ProjectArg.parse(args).projectId))

  handle('shots:list', async () => {
    const ctx = await workspace.projectIds()
    return ctx ? listShots(ctx.folder, [...ctx.projectIds]) : {}
  })

  // Versions: the service validates every input itself.
  const { versions } = deps
  handle('versions:list', () => versions.list())
  handle('versions:save', () => versions.save())
  handle('versions:preview', (args) => versions.preview(args))
  handle('versions:restore', (args) => versions.restore(args))
  handle('versions:undo', (args) => versions.undo(args))
  handle('trash:info', () => versions.trash())
  handle('trash:empty', (args) => versions.emptyTrash(args))
}
