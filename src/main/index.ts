import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, powerSaveBlocker, session, shell, Tray } from 'electron'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { GuardState } from '@shared/guard'
import { exec } from './exec'
import { loadShellPath } from './shell-env'
import { killAllTasks } from './tasks'
import { createClaudeAdapter } from './scanner/claude-adapter'
import { fakeAdapter } from './scanner/fake-adapter'
import { TurnLimitGuard } from './scanner/turn-limit-guard'
import { ptyBackend } from './services/sessions/pty-backend'
import { findTmux, TmuxBackend, tmuxVersion } from './services/sessions/tmux-backend'
import { PreviewManager } from './services/preview/preview-manager'
import { capturePage } from './services/preview/capture'
import { saveShot } from './services/shots/shots'
import { handleAssetProtocol, registerAssetScheme } from './services/shots/protocol'
import { createCore, SKIPPED_GUARD } from './app/core'
import { agentCheck } from './services/agent-check'
import { createHandlers, type Core } from './contract/handlers'
import { registerIpc } from './contract/ipc'
import { withActionLog } from './contract/dispatch'
import { AppRouter, createAppHandlers } from './app/router'
import { HostService } from './services/host/host-service'
import { ClientService } from './services/client/client-service'
import { safeStorageSecretStore } from './extensions/secret-store'
import { ServerStreams } from './contract/streams'
import { ActionLog } from './services/host/action-log'
import { execFileSync } from 'node:child_process'

/** The Mac's own name ("Noa's MacBook Air"), as devices will see it. */
function computerName(): string {
  try {
    return execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim() || hostname()
  } catch {
    return hostname().replace(/\.local$/, '')
  }
}

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

// Started at login with --hidden: sharing runs in the menu bar, no window until asked.
const startHidden = process.argv.includes('--hidden')
let sharing = false
let tray: Tray | null = null

void app.whenReady().then(async () => {
  lockDownNetwork()
  // Loaded in parallel with the window so startup stays fast.
  const shellReady = loadShellPath(exec)
  const userData = app.getPath('userData')

  // Claude Code must prove it honours the turn limit before it may read a folder.
  let core: Core | null = null
  const guard = new TurnLimitGuard(join(userData, 'claude-guard.json'), exec, (s) => core?.streams.emit('guard:changed', s))
  // Sessions in Revive's own tmux server outlive it; without tmux they're direct children and stop with it.
  const tmux = findTmux()
  const dev = !app.isPackaged
  const backend = tmux
    ? new TmuxBackend({
        tmux,
        // Tests use their own socket so they never touch the real one.
        socket: (dev && process.env['REVIVE_TMUX_SOCKET']) || 'revive',
        config: join(import.meta.dirname, '../../resources/tmux.conf'),
        exitDir: join(userData, 'tmux-exit')
      })
    : ptyBackend
  // Development and tests only: stand-ins for Claude Code and Codex.
  const agentCommands = dev
    ? Object.fromEntries(
        (['claude', 'codex'] as const).flatMap((k) => {
          const file = process.env[`REVIVE_AGENT_${k.toUpperCase()}`]
          return file ? [[k, { file: 'node', args: [file] }]] : []
        })
      )
    : {}
  core = createCore({
    userData,
    backend,
    tmuxVersion: tmux ? tmuxVersion(tmux) : null,
    agentCommands,
    agentCheck: agentCheck(exec),
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

  // This computer's core, for its own window and for paired devices; every change goes in the action log.
  const coreHandlers = createHandlers(c, {
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

  // What this computer's window hears, from whichever side is doing the work.
  const out = new ServerStreams()
  const log = new ActionLog(join(userData, 'action-log.jsonl'))
  const logged = withActionLog(coreHandlers, log)

  let lastMode: 'local' | 'client' = 'local'
  let router: AppRouter | null = null
  const client = new ClientService({
    userData,
    secrets: safeStorageSecretStore,
    events: {
      stream: (stream, payload) => router?.fromHost(stream, payload),
      status: (status) => {
        out.emit('client:status', status)
        // Local ↔ Host: the window starts over, so nothing from the other side lingers.
        if (client.mode !== lastMode) {
          lastMode = client.mode
          mainWindow?.webContents.reload()
        }
      }
    }
  })

  let awake: number | null = null
  const host = new HostService({
    userData,
    core: c,
    handlers: logged,
    out,
    log,
    platform: {
      hostName: computerName(),
      exec,
      persistentSessions: backend.persistent,
      keepAwake: (on) => {
        if (on && awake === null) awake = powerSaveBlocker.start('prevent-app-suspension')
        if (!on && awake !== null) {
          powerSaveBlocker.stop(awake)
          awake = null
        }
      },
      loginItem: {
        get: () => app.getLoginItemSettings().openAtLogin,
        set: (on) => app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] })
      },
      sharingChanged: (on) => {
        sharing = on
        updateTray(on)
      }
    },
    checkOutputs,
    webRoot: join(import.meta.dirname, '../web'),
    // Tests only (unpackaged): the https stand-in for `tailscale serve` in the WebKit test.
    extraPublicHosts: dev && process.env['REVIVE_TEST_PUBLIC_HOST'] ? [process.env['REVIVE_TEST_PUBLIC_HOST']] : []
  })
  router = new AppRouter(out, c, logged, withActionLog(createAppHandlers(host, client), log), client)
  const r = router

  handleAssetProtocol(
    () => c.workspace.projectIds(),
    () => (client.mode === 'client' ? (path) => client.asset(path) : null)
  )
  registerIpc({ ipcMain, handlers: r.handlers(), streams: r.out, sessions: r.sessions(), target: () => mainWindow?.webContents ?? null, checkOutputs })

  // Back to the Host this app was paired with, or back to sharing this computer, as before.
  client.resume()
  lastMode = client.mode
  await host.init()
  // Sessions an earlier Revive left running: take over the ones of known projects, list the rest.
  await c.sessions.adopt().catch((e: unknown) => console.error('[sessions] could not adopt', e))
  powerMonitor.on('resume', () => client.wake())
  powerMonitor.on('unlock-screen', () => client.wake())

  const openWindow = () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow(preview)
    }
  }
  function updateTray(on: boolean): void {
    if (!on) {
      tray?.destroy()
      tray = null
      return
    }
    if (!tray) {
      const icon = nativeImage.createFromPath(join(import.meta.dirname, '../../resources/trayTemplate.png'))
      icon.setTemplateImage(true)
      tray = new Tray(icon)
      tray.setToolTip('Revive is sharing this computer')
    }
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Revive', click: openWindow },
        { label: 'Pause sharing', click: () => void host.setSharing(false) },
        { type: 'separator' },
        { label: 'Quit Revive', click: () => app.quit() }
      ])
    )
  }

  if (!(startHidden && sharing)) createWindow(preview)
  app.on('activate', openWindow)

  // Nothing Revive started may outlive it. Wait (briefly) for every process group to stop.
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    c.scans.abortAll()
    killAllTasks()
    client.close()
    // Hosting: everything keeps running for paired devices. Local: dev servers stop; agents per Settings.
    const policy = { hosting: host.status().sharing, keepAgents: c.settings.get().keepAgentsRunning }
    void Promise.race([Promise.all([c.sessions.quit(policy), host.stop()]), new Promise((r) => setTimeout(r, 5000))]).finally(() => app.quit())
  })
})

// While this computer is shared, closing the window leaves Revive running in the menu bar.
app.on('window-all-closed', () => {
  if (!sharing) app.quit()
})
