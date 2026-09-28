/// <reference lib="dom" />
import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { stubFolderDialog } from './helpers'

/**
 * The real download, installed like a buyer would: open the DMG, drag the
 * app out (to a scratch "Applications" folder), eject, launch it with a
 * fresh data folder, read the sample folder, run a project, and open a
 * terminal in the tmux that ships inside the app.
 *
 * REVIVE_DMG picks the image (default: the newest in REVIVE_RELEASE_DIR or release/).
 * REVIVE_REAL_SCAN=1 reads the folder with the real Claude Code (needs it installed and signed in;
 * costs a few cents). Without it the folder comes with a manifest, as after an earlier read.
 */
const releaseDir = resolve(process.env['REVIVE_RELEASE_DIR'] ?? 'release')
function findDmg(): string {
  if (process.env['REVIVE_DMG']) return resolve(process.env['REVIVE_DMG'])
  const dmgs = readdirSync(releaseDir).filter((f) => f.endsWith('.dmg')).map((f) => join(releaseDir, f))
  if (!dmgs.length) throw new Error(`No .dmg in ${releaseDir}: run npm run dist first`)
  return dmgs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!
}
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8' })

/** Opens the DMG, copies the app out as Finder would, and ejects it. */
function install(dmg: string, root: string): string {
  const mount = join(root, 'mnt')
  sh('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmg])
  try {
    cpSync(join(mount, 'Revive.app'), join(root, 'Applications', 'Revive.app'), { recursive: true, verbatimSymlinks: true })
  } finally {
    sh('hdiutil', ['detach', mount, '-force'])
  }
  return join(root, 'Applications', 'Revive.app')
}

test('install the DMG, launch, read the sample folder, run a project, open a terminal in the bundled tmux', async () => {
  const dmg = findDmg()
  const root = mkdtempSync(join(tmpdir(), 'revive-install-'))
  const mount = join(root, 'mnt')
  const apps = join(root, 'Applications')
  const userData = join(root, 'user-data')
  // Revive names its tmux socket after a custom data folder (src/main/paths.ts): never the real "revive".
  const socket = `revive-${createHash('sha256').update(userData).digest('hex').slice(0, 10)}`

  // --- The disk image: the app, the Applications link and the designed background.
  sh('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmg])
  try {
    expect(existsSync(join(mount, 'Revive.app'))).toBe(true)
    expect(lstatSync(join(mount, 'Applications')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(mount, 'Applications'))).toBe('/Applications')
    expect(existsSync(join(mount, '.background.tiff'))).toBe(true)
    expect(existsSync(join(mount, '.VolumeIcon.icns'))).toBe(true)
    expect(existsSync(join(mount, '.DS_Store'))).toBe(true) // the window layout
    // "Drag to Applications": copied as Finder would, then the image is ejected.
    cpSync(join(mount, 'Revive.app'), join(apps, 'Revive.app'), { recursive: true, verbatimSymlinks: true })
  } finally {
    sh('hdiutil', ['detach', mount, '-force'])
  }
  const app = join(apps, 'Revive.app')

  // --- What's inside: both architectures, a valid signature, the bundled tmux.
  const res = join(app, 'Contents', 'Resources')
  expect(sh('lipo', ['-archs', join(app, 'Contents', 'MacOS', 'Revive')]).trim().split(' ').sort()).toEqual(['arm64', 'x86_64'])
  expect(sh('lipo', ['-archs', join(res, 'bin', 'tmux')]).trim().split(' ').sort()).toEqual(['arm64', 'x86_64'])
  expect(sh('lipo', ['-archs', join(res, 'app.asar.unpacked', 'node_modules', 'node-pty', 'build', 'Release', 'pty.node')]).trim().split(' ').sort()).toEqual(['arm64', 'x86_64'])
  expect(spawnSync('codesign', ['--verify', '--deep', '--strict', app]).status).toBe(0)
  for (const f of ['tmux.conf', 'trayTemplate.png', 'trayTemplate@2x.png']) expect(existsSync(join(res, f)), f).toBe(true)
  // A build made with a release feed knows where to look for updates.
  if (process.env['REVIVE_UPDATE_URL'] || process.env['REVIVE_GITHUB_REPO']) expect(existsSync(join(res, 'app-update.yml'))).toBe(true)
  // The bundled tmux needs nothing from Homebrew.
  expect(sh('otool', ['-L', join(res, 'bin', 'tmux')])).not.toMatch(/homebrew|\/usr\/local|libevent|ncurses/)

  // --- A fresh Revive, as on a new account.
  const folder = join(root, 'my-ai-projects')
  cpSync('fixtures/sample-folder', folder, { recursive: true })
  const realScan = process.env['REVIVE_REAL_SCAN'] === '1'
  if (!realScan) {
    // As after onboarding and an earlier read (CI has no signed-in Claude Code): language chosen, folder chosen, manifest there.
    cpSync('fixtures/sample-folder.manifest.json', join(folder, '.revive', 'manifest.json'))
    mkdirSync(userData, { recursive: true })
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ uiLanguage: 'en', lastFolder: folder, recentFolders: [folder] }))
  }
  // REVIVE_TEST_ARCH=x86_64 runs the Intel half (under Rosetta on Apple silicon).
  const arch = process.env['REVIVE_TEST_ARCH']
  let executablePath = join(app, 'Contents', 'MacOS', 'Revive')
  if (arch) {
    const wrapper = join(root, 'revive-arch.sh')
    writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/arch -${arch} "${executablePath}" "$@"\n`, { mode: 0o755 })
    executablePath = wrapper
  }
  const revive = await electron.launch({
    executablePath,
    // No PATH to Homebrew's tmux: the bundled one must be used. The test folder is a temporary copy, so no "Move to Applications".
    env: { ...(process.env as Record<string, string>), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', REVIVE_USER_DATA: userData, REVIVE_NO_MOVE_PROMPT: '1' }
  })
  try {
    const win = await revive.firstWindow()
    expect(await revive.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion() }))).toMatchObject({ packaged: true })
    if (arch) expect(await revive.evaluate(() => process.arch)).toBe(arch === 'x86_64' ? 'x64' : arch)
    if (realScan) {
      await win.getByTestId('welcome-en').click()
      await expect(win.getByTestId('prereq-continue')).toBeEnabled({ timeout: 60_000 })
      await win.getByTestId('prereq-continue').click()
      await stubFolderDialog(revive, folder)
      await win.getByTestId('folder-pick').click()
      await win.getByTestId('scan-start').click()
      await expect(win.getByTestId('scan-result')).toContainText('Found 2 projects.', { timeout: 240_000 })
    }
    await expect(win.getByTestId('project-card')).toHaveCount(2, { timeout: 60_000 })

    // Run the static project: served by Revive's own server, which runs from inside app.asar.
    await win.locator('[data-project="bakery-site"]').getByTestId('card-action').click()
    await expect(win.getByTestId('status-pill')).toHaveAttribute('data-status', 'running', { timeout: 60_000 })

    // A terminal: a real tmux session, from the tmux inside the app.
    await win.getByTestId('terminal-open-shell').click()
    await expect(win.getByTestId('terminal-view')).toBeVisible()
    await win.locator('.xterm-helper-textarea').focus()
    await win.keyboard.type('echo "inside $TMUX"\n')
    await expect.poll(() => win.locator('.xterm-rows').innerText(), { timeout: 20_000 }).toContain(`inside /private/tmp/tmux-${process.getuid!()}/${socket},`)
    // The tmux server running it is the one inside the app.
    const ps = sh('ps', ['-axo', 'command'])
    expect(ps).toContain(`${join(res, 'bin', 'tmux')} -L ${socket}`)
    // Never the real socket.
    expect(ps).not.toMatch(/tmux -L revive -f/)
    await win.getByTestId('terminal-end').click()
    await win.getByTestId('terminal-end-confirm-button').click()
  } finally {
    await revive.close()
    // This Revive's own tmux server (named after its data folder), if anything is left.
    spawnSync(join(res, 'bin', 'tmux'), ['-L', socket, 'kill-server'])
    rmSync(`/private/tmp/tmux-${process.getuid!()}/${socket}`, { force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * Updates from a feed (here a local stand-in for R2 or GitHub Releases on the
 * port this build was made with, REVIVE_UPDATE_URL=http://127.0.0.1:47111/):
 * a newer version is found and downloaded in the background, with no dialog
 * and no restart. Installing needs the update signed by the same Developer ID
 * as the running app: a signed build must say "ready"; unsigned, only this same bundle passes.
 */
test('updates: finds a newer version and downloads it in the background, never restarting', async () => {
  const dmg = findDmg()
  const root = mkdtempSync(join(tmpdir(), 'revive-update-'))
  const app = install(dmg, root)
  const feedFile = join(app, 'Contents', 'Resources', 'app-update.yml')
  if (!existsSync(feedFile) || !readFileSync(feedFile, 'utf8').includes('127.0.0.1:47111')) test.skip(true, 'this build was not made with the local test feed (REVIVE_UPDATE_URL=http://127.0.0.1:47111/)')
  const zip = readdirSync(dirname(dmg)).find((f) => f.endsWith('-mac.zip'))!
  const real = readFileSync(join(dirname(dmg), 'latest-mac.yml'), 'utf8')
  // The same files, announced as a newer version.
  const feed = real.replace(/^version: .*$/m, 'version: 99.0.0')
  const requests: string[] = []
  let served = 0
  const server = createServer((req, res) => {
    requests.push(req.url ?? '')
    if (req.url?.startsWith('/latest-mac.yml')) return res.end(feed)
    if (req.url === `/${zip}`) {
      const data = readFileSync(join(dirname(dmg), zip))
      served = data.length
      return res.writeHead(200, { 'content-length': data.length }).end(data)
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(47111, '127.0.0.1', r))
  // electron-updater keeps a downloaded update here and reuses it: start from nothing, so it really downloads.
  const cache = join(homedir(), 'Library', 'Caches', 'revive-updater')
  rmSync(cache, { recursive: true, force: true })
  const revive = await electron.launch({
    executablePath: join(app, 'Contents', 'MacOS', 'Revive'),
    env: { ...(process.env as Record<string, string>), REVIVE_USER_DATA: join(root, 'user-data'), REVIVE_NO_MOVE_PROMPT: '1', REVIVE_UPDATE_FIRST_CHECK_MS: '1000' }
  })
  try {
    const win = await revive.firstWindow()
    const pid = await revive.evaluate(() => process.pid)
    const status = () => win.evaluate(async () => ((await (window as unknown as { revive: { invoke(c: string): Promise<{ v: { state: string; version: string | null } }> } }).revive.invoke('update:status')).v))
    await expect.poll(async () => (await status()).state, { timeout: 180_000, intervals: [1000] }).toMatch(/ready|error/)
    expect(requests.some((u) => u.startsWith('/latest-mac.yml'))).toBe(true)
    expect(requests).toContain(`/${zip}`)
    expect(served).toBeGreaterThan(50_000_000)
    const signed = Boolean(process.env['CSC_LINK'] || process.env['CSC_NAME'])
    const final = await status()
    if (signed) expect(final).toMatchObject({ state: 'ready', version: '99.0.0' })
    // Whatever happened, no dialog and no restart: the same process is still running.
    expect(await revive.evaluate(() => process.pid)).toBe(pid)
    expect(await revive.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    // Unsigned, "ready" only means the same bundle came back (its ad hoc signature matches itself);
    // a different ad hoc build would be refused. Real updates need the Developer ID signature.
    console.log(`update status after download: ${final.state}${signed ? '' : ' (ad hoc build, same bundle re-announced)'}`)
  } finally {
    await revive.close()
    server.close()
    spawnSync('pkill', ['-f', join(root, 'Applications')])
    rmSync(root, { recursive: true, force: true })
    rmSync(cache, { recursive: true, force: true })
  }
})
