import { expect, test } from '@playwright/test'
import { freshUserData, launch, sampleFolder, stubFolderDialog } from './helpers'

// Grows milestone by milestone; the full journey lands in M5.
test('first run: language, computer check, folder, then straight to My projects next time', async () => {
  const userData = freshUserData()
  const folder = sampleFolder()

  const app = await launch(userData)
  const win = await app.firstWindow()

  await win.getByTestId('welcome-he').click()
  await expect(win.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(win.getByTestId('onboarding-step')).toHaveText('שלב 1 מתוך 2')

  // Real check on this machine. Needs Claude Code installed and signed in, and git.
  await expect(win.getByTestId('prereq-claude')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 })
  await expect(win.getByTestId('prereq-continue')).toBeEnabled()

  // Language switch in the top bar of a full screen view keeps the step.
  await win.getByTestId('lang-en').click()
  await expect(win.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(win.getByTestId('onboarding-step')).toHaveText('Step 1 of 2')

  await win.getByTestId('prereq-continue').click()
  await stubFolderDialog(app, folder)
  await win.getByTestId('folder-pick').click()

  await expect(win.getByTestId('current-folder')).toContainText('my-ai-projects')
  await expect(win.getByTestId('nav-projects')).toHaveText('My projects')
  await app.close()

  const again = await launch(userData)
  const win2 = await again.firstWindow()
  await expect(win2.getByTestId('current-folder')).toContainText('my-ai-projects')
  await win2.getByTestId('change-folder').click()
  await expect(win2.getByTestId('recent-folder')).toContainText('my-ai-projects')
  await again.close()
})

test('read the folder: saved version first, progress, gallery, nothing outside .revive changed', async () => {
  const { readFileSync, readdirSync, statSync, existsSync } = await import('node:fs')
  const { join, relative } = await import('node:path')
  const userData = freshUserData()
  const folder = sampleFolder()
  const snapshot = () => {
    const out: Record<string, string> = {}
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (n === '.revive') continue
        if (statSync(p).isDirectory()) walk(p)
        else out[relative(folder, p)] = readFileSync(p, 'utf8')
      }
    }
    walk(folder)
    return out
  }
  const before = snapshot()

  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('welcome-en').click()
  await expect(win.getByTestId('prereq-continue')).toBeEnabled({ timeout: 30_000 })
  await win.getByTestId('prereq-continue').click()
  await stubFolderDialog(app, folder)
  await win.getByTestId('folder-pick').click()

  await win.getByTestId('scan-start').click()
  await expect(win.getByTestId('scan-badge')).toHaveText('Reading only')
  await expect(win.getByTestId('scan-phase')).toHaveAttribute('data-phase', 'reading')
  await expect(win.getByTestId('scan-found')).toContainText('habit-counter')

  await expect(win.getByTestId('scan-result')).toContainText('Found 2 projects.', { timeout: 30_000 })
  await expect(win.getByTestId('project-card')).toHaveCount(2)
  await expect(win.getByTestId('loose-files')).toContainText("1 file isn't part of any project.")

  expect(snapshot()).toEqual(before)
  expect(existsSync(join(folder, '.revive/manifest.json'))).toBe(true)
  const versions = JSON.parse(readFileSync(join(folder, '.revive/versions.json'), 'utf8'))
  expect(versions[0].kind).toBe('scan')
  await app.close()

  // Next launch: the gallery is there straight away.
  const again = await launch(userData)
  const win2 = await again.firstWindow()
  await expect(win2.getByTestId('project-card')).toHaveCount(2)
  await again.close()
})

test('start a project: live preview, picture, status saved, stop, and nothing outlives Revive', async () => {
  const { readFileSync, existsSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { connect } = await import('node:net')
  const listening = (port: number) =>
    new Promise<boolean>((resolve) => {
      const s = connect({ port, host: '127.0.0.1' })
      s.once('connect', () => (s.destroy(), resolve(true)))
      s.once('error', () => resolve(false))
    })
  const userData = freshUserData()
  const folder = sampleFolder()
  const manifestOf = () => JSON.parse(readFileSync(join(folder, '.revive/manifest.json'), 'utf8'))

  const app = await launch(userData)
  const win = await app.firstWindow()
  // Any renderer crash fails the test, not just a missing element later on.
  const pageErrors: string[] = []
  win.on('pageerror', (e) => pageErrors.push(e.message))
  await win.getByTestId('welcome-en').click()
  await expect(win.getByTestId('prereq-continue')).toBeEnabled({ timeout: 30_000 })
  await win.getByTestId('prereq-continue').click()
  await stubFolderDialog(app, folder)
  await win.getByTestId('folder-pick').click()
  await win.getByTestId('scan-start').click()
  await expect(win.getByTestId('scan-result')).toContainText('Found 2 projects.', { timeout: 30_000 })
  // Indexing and descriptions both counted: $0.01 + $0.02.
  await expect(win.getByTestId('scan-cost')).toContainText('$0.03')

  // One button: "Check if it works" starts the plain-HTML bakery site and opens its page.
  await win.locator('[data-project="bakery-site"]').getByTestId('card-action').click()
  await expect(win.getByTestId('project-page')).toBeVisible()
  await expect(win.getByTestId('status-pill')).toHaveAttribute('data-status', 'running', { timeout: 30_000 })
  await expect(win.getByTestId('preview-frame')).toBeVisible()

  // The live preview is a native view over the frame, showing the local server.
  const view = async () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!
      const v = w.contentView.children[0] as Electron.WebContentsView | undefined
      return v ? { url: v.webContents.getURL(), bounds: v.getBounds(), title: v.webContents.getTitle() } : null
    })
  await expect.poll(async () => (await view())?.url ?? '', { timeout: 15_000 }).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
  const url = (await view())!.url
  const port = Number(new URL(url).port)
  await expect.poll(async () => (await view())?.title).toContain('Bakery')

  await win.getByTestId('device-phone').click()
  await expect.poll(async () => (await view())?.bounds.width).toBe(390)

  // Facts saved for any client: verified, with the address and port.
  await expect.poll(() => manifestOf().projects[0].status).toBe('verified')
  expect(manifestOf().projects[0].run).toMatchObject({ url, port })
  expect(manifestOf().projects[0].run.verified_at).toBeTruthy()

  // A picture was taken offscreen and is served through revive://, never file://.
  await expect.poll(() => existsSync(join(folder, '.revive/shots/bakery-site.png')), { timeout: 20_000 }).toBe(true)

  await win.getByTestId('project-stop').click()
  await expect(win.getByTestId('status-pill')).toHaveAttribute('data-status', 'verified')
  await expect(win.getByTestId('preview-frame')).toHaveCount(0)
  expect(await view()).toBeNull()
  expect(await listening(port)).toBe(false)

  await win.getByText('My projects').first().click()
  const picture = win.locator('[data-project="bakery-site"]').getByTestId('project-picture')
  await expect(picture).toHaveAttribute('src', /^revive:\/\/local\/shots\/bakery-site\.png\?v=\d+$/)
  await expect.poll(() => picture.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(100)

  // Start again, then quit: the server must not outlive Revive.
  await win.locator('[data-project="bakery-site"]').getByTestId('card-action').click()
  await expect(win.getByTestId('status-pill')).toHaveAttribute('data-status', 'running', { timeout: 30_000 })
  const port2 = Number(new URL(manifestOf().projects[0].run.url).port)
  expect(await listening(port2)).toBe(true)
  expect(pageErrors).toEqual([])
  await app.close()
  expect(await listening(port2)).toBe(false)
})

test('go back to a saved version and undo it: preview hidden under dialogs, project stopped and offered back, trash emptied', async () => {
  const { readFileSync, writeFileSync, existsSync, readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const userData = freshUserData()
  const folder = sampleFolder()
  const page = join(folder, 'bakery-site/index.html')
  const original = readFileSync(page, 'utf8')

  const app = await launch(userData)
  const win = await app.firstWindow()
  const pageErrors: string[] = []
  win.on('pageerror', (e) => pageErrors.push(e.message))
  await win.getByTestId('welcome-en').click()
  await expect(win.getByTestId('prereq-continue')).toBeEnabled({ timeout: 30_000 })
  await win.getByTestId('prereq-continue').click()
  await stubFolderDialog(app, folder)
  await win.getByTestId('folder-pick').click()
  await win.getByTestId('scan-start').click()
  await expect(win.getByTestId('scan-result')).toContainText('Found 2 projects.', { timeout: 30_000 })

  // Start the bakery, then change it the way an agent might.
  await win.locator('[data-project="bakery-site"]').getByTestId('card-action').click()
  await expect(win.getByTestId('status-pill')).toHaveAttribute('data-status', 'running', { timeout: 30_000 })
  writeFileSync(page, '<h1>Changed by an agent</h1>')
  writeFileSync(join(folder, 'bakery-site/new-page.html'), '<p>new</p>')
  const nativeViews = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.length)
  await expect.poll(nativeViews).toBe(1)

  // A dialog over the preview: the native view is hidden first, a picture stands in, and it comes back after.
  await win.getByTestId('project-versions').click()
  await expect(win.getByTestId('versions-dialog')).toBeVisible()
  expect(await nativeViews()).toBe(0)
  await expect(win.getByTestId('preview-standin')).toBeVisible()
  await win.getByTestId('versions-dialog').getByText('Close').click()
  await expect.poll(nativeViews).toBe(1)

  await win.getByTestId('project-versions').click()
  await win.getByTestId('versions-dialog-row').first().click()
  const dialog = win.getByTestId('restore-dialog')
  await expect(dialog.getByTestId('restore-summary')).toHaveText("1 file will go back the way it was. 1 file made since then will move to Revive's trash.")
  await expect(dialog).toContainText('First, Revive will stop: Sunrise Bakery.')
  expect(await nativeViews()).toBe(0)
  await dialog.getByTestId('restore-confirm').click()

  const done = win.getByTestId('restore-done')
  await expect(done).toContainText('2 files changed.')
  expect(readFileSync(page, 'utf8')).toBe(original)
  expect(existsSync(join(folder, 'bakery-site/new-page.html'))).toBe(false)
  const trashRoot = join(folder, '.revive/trash')
  expect(readdirSync(join(trashRoot, readdirSync(trashRoot)[0]!, 'bakery-site'))).toEqual(['new-page.html'])
  // It was stopped for the restore, and is offered back.
  await expect(win.getByTestId('status-pill')).not.toHaveAttribute('data-status', 'running')
  await done.getByTestId('start-again').getByRole('button', { name: 'Start' }).click()
  await expect(win.getByTestId('status-pill')).toHaveAttribute('data-status', 'running', { timeout: 30_000 })

  // History: plain titles, newest first; Undo brings the agent's change back.
  await win.getByTestId('nav-history').click()
  await expect(win.getByTestId('version-title').first()).toContainText('Before going back to the version from')
  await expect(win.getByTestId('version-title').last()).toHaveText('Before reading the folder')
  await win.getByTestId('restore-undo').click()
  await expect(win.getByTestId('restore-done')).toContainText('Undone.')
  expect(readFileSync(page, 'utf8')).toBe('<h1>Changed by an agent</h1>')
  expect(readFileSync(join(folder, 'bakery-site/new-page.html'), 'utf8')).toBe('<p>new</p>')

  // Only the user empties the trash, after confirming.
  await expect(win.getByTestId('trash')).toContainText('moved aside when going back')
  await win.getByTestId('trash-empty').click()
  await win.getByTestId('trash-empty-confirm').click()
  await expect(win.getByTestId('trash')).toContainText('The trash is empty.')
  expect(existsSync(trashRoot)).toBe(false)

  expect(pageErrors).toEqual([])
  await app.close()
})
