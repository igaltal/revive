import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import type { GuardState } from '@shared/guard'
import { exec } from './exec'
import { loadShellPath } from './shell-env'
import { killAllTasks } from './tasks'
import { createClaudeAdapter } from './scanner/claude-adapter'
import { fakeAdapter } from './scanner/fake-adapter'
import { TurnLimitGuard } from './scanner/turn-limit-guard'
import { ptyBackend } from './services/sessions/pty-backend'
import { PreviewManager } from './services/preview/preview-manager'
import { capturePage } from './services/preview/capture'
import { saveShot } from './services/shots/shots'
import { handleAssetProtocol, registerAssetScheme } from './services/shots/protocol'
import { createCore, SKIPPED_GUARD } from './app/core'
import { createHandlers, type Core } from './contract/handlers'
import { registerIpc } from './contract/ipc'
import { startDevWsServer } from './contract/ws-server'

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

void app.whenReady().then(async () => {
  lockDownNetwork()
  // Loaded in parallel with the window so startup stays fast.
  const shellReady = loadShellPath(exec)

  // Claude Code must prove it honours the turn limit before it may read a folder.
  let core: Core | null = null
  const guard = new TurnLimitGuard(join(app.getPath('userData'), 'claude-guard.json'), exec, (s) => core?.streams.emit('guard:changed', s))
  core = createCore({
    userData: app.getPath('userData'),
    backend: ptyBackend,
    // Plain pages are served by Revive's own tiny server, run by Electron in Node mode.
    staticServer: { file: process.execPath, args: [join(import.meta.dirname, 'static-server.js')], env: { ELECTRON_RUN_AS_NODE: '1' } },
    adapter: testAgent ? fakeAdapter(testAgent) : createClaudeAdapter(guard),
    guard: testAgent ? SKIPPED_GUARD : { current: (): GuardState => guard.current(), recheck: () => guard.ensure(true) },
    shellReady,
    capturePage
  })
  const c = core
  if (!testAgent) void shellReady.then(() => guard.ensure())

  const preview = new PreviewManager(() => mainWindow, c.runner, c.bus, async (projectId, png) => {
    const path = await saveShot(await c.workspace.current(), projectId, png)
    if (path) c.bus.emit({ type: 'shot.captured', projectId, path })
  })
  handleAssetProtocol(() => c.workspace.projectIds())

  // Every method comes from the contract registry, for IPC and the dev WebSocket alike.
  const handlers = createHandlers(c, {
    pickFolder: async (defaultPath) => {
      const options = { properties: ['openDirectory' as const], defaultPath }
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    openExternal: (url) => shell.openExternal(url),
    preview: {
      show: (projectId, bounds, device) => preview.show(projectId, bounds, device),
      hide: () => preview.hide(),
      cover: () => preview.cover(),
      uncover: () => preview.uncover(),
      reload: () => preview.reload(),
      openInBrowser: (projectId) => preview.openInBrowser(projectId)
    }
  })
  // Outputs are checked against the contract too, except in the packaged app.
  const checkOutputs = !app.isPackaged
  registerIpc({ ipcMain, handlers, streams: c.streams, hub: c.hub, target: () => mainWindow?.webContents ?? null, checkOutputs })

  // Development only: the same contract over a WebSocket on 127.0.0.1, with a token printed once.
  // No UI shows it; pairing and device tokens are M7.
  const devWs =
    process.env['REVIVE_DEV_WS'] === '1'
      ? await startDevWsServer({
          handlers,
          streams: c.streams,
          hub: c.hub,
          assets: () => c.workspace.projectIds(),
          port: Number(process.env['REVIVE_DEV_WS_PORT'] ?? 0) || undefined,
          checkOutputs
        })
      : null
  if (devWs) process.stderr.write(`[revive] dev WebSocket: ${devWs.url} token=${devWs.token}\n`)

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
    c.scans.abortAll()
    killAllTasks()
    void Promise.race([Promise.all([c.runner.stopAll(), devWs?.close()]), new Promise((r) => setTimeout(r, 5000))]).finally(() => app.quit())
  })
})

app.on('window-all-closed', () => app.quit())
