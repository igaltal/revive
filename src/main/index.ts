import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import type { GuardState } from '@shared/guard'
import { SettingsStore } from './settings-store'
import { registerIpc, send } from './ipc/register'
import { exec } from './exec'
import { loadShellPath } from './shell-env'
import { killAllTasks } from './tasks'
import { ScanController } from './scanner/controller'
import { createClaudeAdapter } from './scanner/claude-adapter'
import { fakeAdapter } from './scanner/fake-adapter'
import { TurnLimitGuard } from './scanner/turn-limit-guard'
import { RuntimeBus } from './services/runtime-bus'
import { SessionHub } from './services/sessions/session-hub'
import { ptyBackend } from './services/sessions/pty-backend'
import { Runner } from './services/runner/runner'
import { Workspace } from './services/workspace'
import { PreviewManager } from './services/preview/preview-manager'
import { VersionService } from './services/versions/version-service'
import { capturePage } from './services/preview/capture'
import { saveShot } from './services/shots/shots'
import { handleAssetProtocol, registerAssetScheme } from './services/shots/protocol'

const isDev = !app.isPackaged && Boolean(process.env['ELECTRON_RENDERER_URL'])
let mainWindow: BrowserWindow | null = null
// End-to-end tests of dev builds can swap Claude for an offline fake. Never in a packaged app.
const testAgent = !app.isPackaged ? process.env['REVIVE_TEST_AGENT'] : undefined

// Tests run against a throwaway settings folder.
if (process.env['REVIVE_USER_DATA']) app.setPath('userData', process.env['REVIVE_USER_DATA'])
registerAssetScheme()

function createWindow(preview: PreviewManager): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Revive',
    backgroundColor: '#F4F2EC',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // The app shell never navigates away and never opens windows.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  mainWindow.on('closed', () => {
    mainWindow = null
    preview.reset()
  })
}

function lockDownNetwork(): void {
  // The app shell may only load its own files, its own pictures (revive://),
  // and the Vite dev server in dev. Project previews use their own session.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    const allowed =
      url.startsWith('file://') ||
      url.startsWith('devtools://') ||
      url.startsWith('data:') ||
      url.startsWith('revive://local/') ||
      (isDev && /^(http|ws):\/\/(localhost|127\.0\.0\.1):\d+\//.test(url))
    callback({ cancel: !allowed })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

void app.whenReady().then(() => {
  const settings = new SettingsStore(app.getPath('userData'))
  lockDownNetwork()
  // Loaded in parallel with the window so startup stays fast.
  const shellReady = loadShellPath(exec)

  const bus = new RuntimeBus()
  const hub = new SessionHub(ptyBackend, bus)
  // eslint-disable-next-line prefer-const -- the workspace and runner need each other
  let runner: Runner
  const workspace = new Workspace(settings, () => runner.stopAll())
  runner = new Runner({
    hub,
    bus,
    projects: workspace,
    // Plain pages are served by Revive's own tiny server, run by Electron in Node mode.
    staticServer: { file: process.execPath, args: [join(import.meta.dirname, 'static-server.js')], env: { ELECTRON_RUN_AS_NODE: '1' } },
    capture: async (projectId, url) => {
      const png = await capturePage(url)
      return png ? saveShot(await workspace.current(), projectId, png) : null
    }
  })
  const preview = new PreviewManager(() => mainWindow, runner, bus, async (projectId, png) => {
    const path = await saveShot(await workspace.current(), projectId, png)
    if (path) bus.emit({ type: 'shot.captured', projectId, path })
  })
  handleAssetProtocol(() => workspace.projectIds())

  // Claude Code must prove it honours the turn limit before it may read a folder.
  const guard = new TurnLimitGuard(join(app.getPath('userData'), 'claude-guard.json'), exec, (s) => send(mainWindow, 'guard:changed', s))
  // eslint-disable-next-line prefer-const -- versions and scans need each other
  let scans: ScanController
  const versions = new VersionService({ bus, folder: () => workspace.current(), runner, scanning: () => scans.active() !== null })
  scans = new ScanController(
    testAgent ? fakeAdapter(testAgent) : createClaudeAdapter(guard),
    {
      progress: (p) => send(mainWindow, 'scan:progress', p),
      done: (d) => send(mainWindow, 'scan:done', d),
      versionSaved: (v) => versions.announce(v)
    },
    // Nothing running, and no restore half done, while Claude reads the folder.
    async () => {
      await runner.stopAll()
      await versions.whenIdle()
    }
  )
  const guardApi = testAgent
    ? { current: (): GuardState => ({ state: 'skipped' }), recheck: async (): Promise<GuardState> => ({ state: 'skipped' }) }
    : { current: () => guard.current(), recheck: () => guard.ensure(true) }
  if (!testAgent) void shellReady.then(() => guard.ensure())

  registerIpc({ settings, getWindow: () => mainWindow, shellReady, scans, workspace, runner, bus, hub, preview, versions, guard: guardApi })
  createWindow(preview)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(preview)
  })

  // Nothing Revive started may outlive it. Wait (briefly) for every process group to stop.
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    scans.abortAll()
    killAllTasks()
    void Promise.race([runner.stopAll(), new Promise((r) => setTimeout(r, 5000))]).finally(() => app.quit())
  })
})

app.on('window-all-closed', () => app.quit())
