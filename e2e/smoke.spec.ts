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
