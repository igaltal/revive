import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'

export function freshUserData(): string {
  return mkdtempSync(join(tmpdir(), 'revive-e2e-'))
}

/** A throwaway copy of the fixture folder, so tests never touch the repo. */
export function sampleFolder(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'revive-folder-')), 'my-ai-projects')
  cpSync('fixtures/sample-folder', dir, { recursive: true })
  return dir
}

import { resolve } from 'node:path'

/** Launches the built app with throwaway settings and the offline stand-in for Claude. */
export function launch(userData: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  const base = { ...process.env } as Record<string, string>
  return electron.launch({
    args: ['.'],
    env: { ...base, REVIVE_USER_DATA: userData, REVIVE_TEST_AGENT: resolve('fixtures/sample-folder.manifest.json'), REVIVE_TMUX_SOCKET: tmuxSocketFor(userData), ...env }
  })
}

/** Each test app gets its own tmux socket (the same one again on relaunch), never the real `revive` one. */
export function tmuxSocketFor(userData: string): string {
  const socket = `revive-e2e-${basename(userData).replace(/[^a-zA-Z0-9]/g, '')}`
  sockets.add(socket)
  return socket
}
const sockets = new Set<string>()

/** Ends every tmux server the tests started. */
export function killTestTmux(): void {
  for (const s of sockets) {
    spawnSync('tmux', ['-L', s, 'kill-server'])
    rmSync(join(process.env['TMUX_TMPDIR'] || '/tmp', `tmux-${process.getuid?.() ?? 0}`, s), { force: true })
  }
}

/** The native folder dialog can't be clicked by Playwright; answer it from the main process. */
export async function stubFolderDialog(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, folder)
}

/**
 * A stand-in for `tailscale serve`: HTTPS (a throwaway self-signed certificate)
 * in front of the Host on 127.0.0.1, passing requests and WebSocket upgrades
 * through with their Host and Origin headers untouched.
 */
export async function startTlsProxy(target: number, listenPort: number): Promise<{ port: number; close: () => Promise<void> }> {
  const { execFileSync } = await import('node:child_process')
  const { readFileSync } = await import('node:fs')
  const https = await import('node:https')
  const http = await import('node:http')
  const net = await import('node:net')
  const dir = mkdtempSync(join(tmpdir(), 'revive-tls-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' })
  const server = https.createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
    const out = http.request({ host: '127.0.0.1', port: target, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers)
      r.pipe(res)
    })
    out.on('error', () => res.writeHead(502).end())
    req.pipe(out)
  })
  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(target, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
      up.write(`${lines.join('\r\n')}\r\n\r\n`)
      up.write(head)
      socket.pipe(up).pipe(socket)
    })
    up.on('error', () => socket.destroy())
    socket.on('error', () => up.destroy())
  })
  await new Promise<void>((r) => server.listen(listenPort, '127.0.0.1', r))
  return { port: (server.address() as { port: number }).port, close: () => new Promise((r) => server.close(() => r())) }
}

/** A port nothing is listening on right now. */
export async function freePort(): Promise<number> {
  const net = await import('node:net')
  const s = net.createServer().listen(0, '127.0.0.1')
  await new Promise((r) => s.once('listening', r))
  const port = (s.address() as { port: number }).port
  await new Promise((r) => s.close(r))
  return port
}
