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
