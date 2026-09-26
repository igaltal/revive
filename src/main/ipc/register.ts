import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { z } from 'zod'
import type { IpcEvents, EventChannel, RequestArgs, RequestChannel, RequestResult } from '@shared/ipc'
import { HELP_PAGES, type HelpTopic } from '@shared/prereq'
import type { SettingsStore } from '../settings-store'
import { exec } from '../exec'
import { checkPrereqs } from '../prereq'
import { installClaude, signIn } from '../tasks'
import { addRecent, checkFolder, describeRecent } from '../folders'
import { readManifest } from '../manifest-store'
import type { ScanController } from '../scanner/controller'

type Handler<C extends RequestChannel> = (args: RequestArgs<C>) => RequestResult<C> | Promise<RequestResult<C>>

function handle<C extends RequestChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, (_event, args: RequestArgs<C>) => handler(args))
}

export function send<E extends EventChannel>(win: BrowserWindow | null, event: E, payload: IpcEvents[E]): void {
  if (win && !win.isDestroyed()) win.webContents.send(event, payload)
}

const PathArg = z.object({ path: z.string().min(1).max(4096) })
const HelpArg = z.object({ topic: z.enum(Object.keys(HELP_PAGES) as [HelpTopic, ...HelpTopic[]]) })

export function registerIpc(deps: {
  settings: SettingsStore
  getWindow: () => BrowserWindow | null
  /** Resolves once the login-shell PATH is loaded. */
  shellReady: Promise<void>
  scans: ScanController
}): void {
  const { settings, getWindow } = deps
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
    const check = await checkFolder(PathArg.parse(args).path)
    if (check.ok) {
      settings.update({ lastFolder: check.path, recentFolders: addRecent(settings.get().recentFolders, check.path) })
      notifySettings()
    }
    return check
  })
  handle('folder:recent', () => describeRecent(settings.get().recentFolders))

  // The renderer never names a folder to scan: it is always the one the user chose.
  const currentFolder = async (): Promise<string> => {
    const folder = settings.get().lastFolder
    if (!folder) throw new Error('No folder chosen')
    const check = await checkFolder(folder)
    if (!check.ok) throw new Error(`Folder unavailable: ${check.problem}`)
    return check.path
  }

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
}
