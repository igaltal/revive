import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { SettingsStore } from './settings-store'
import { registerIpc } from './ipc/register'

const isDev = !app.isPackaged && Boolean(process.env['ELECTRON_RENDERER_URL'])
let mainWindow: BrowserWindow | null = null

// Tests run against a throwaway settings folder.
if (process.env['REVIVE_USER_DATA']) app.setPath('userData', process.env['REVIVE_USER_DATA'])

function createWindow(): void {
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
  mainWindow.on('closed', () => (mainWindow = null))
}

function lockDownNetwork(): void {
  // The app shell may only load its own files (and the Vite dev server in dev).
  // Project previews get their own session partition in M4.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    const allowed =
      url.startsWith('file://') ||
      url.startsWith('devtools://') ||
      url.startsWith('data:') ||
      (isDev && /^(http|ws):\/\/(localhost|127\.0\.0\.1):\d+\//.test(url))
    callback({ cancel: !allowed })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

void app.whenReady().then(() => {
  const settings = new SettingsStore(app.getPath('userData'))
  lockDownNetwork()
  registerIpc({ settings, getWindow: () => mainWindow })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())

