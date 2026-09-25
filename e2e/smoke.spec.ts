import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Grows milestone by milestone; the full journey lands in M5.
test('first run: choose Hebrew, flip to English, settings persist', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'revive-e2e-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, REVIVE_USER_DATA: userData } })
  const win = await app.firstWindow()

  await win.getByTestId('welcome-he').click()
  await expect(win.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(win.getByTestId('nav-projects')).toHaveText('הפרויקטים שלי')

  await win.getByTestId('lang-en').click()
  await expect(win.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(win.getByTestId('nav-projects')).toHaveText('My projects')
  await app.close()

  const again = await electron.launch({ args: ['.'], env: { ...process.env, REVIVE_USER_DATA: userData } })
  const win2 = await again.firstWindow()
  await expect(win2.getByTestId('nav-projects')).toHaveText('My projects')
  await again.close()
})
