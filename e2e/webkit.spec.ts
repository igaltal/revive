/// <reference lib="dom" />
import { devices, expect, test, webkit } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { freePort, freshUserData, killTestTmux, launch, sampleFolder, startTlsProxy, stubFolderDialog } from './helpers'

test.afterAll(() => killTestTmux())

/**
 * The iPhone's engine (WebKit, iPhone 15 emulation), over HTTPS as a phone
 * reaches the Host through `tailscale serve`. A TLS proxy stands in for it.
 * (Over plain http WebKit rightly refuses the Secure cookie.)
 */
test('iPhone engine over https: pair, approve, see the projects, use the terminal keys, revoke', async () => {
  test.setTimeout(120_000)
  const proxyPort = await freePort()
  const publicHost = `localhost:${proxyPort}`
  const userData = freshUserData()
  const app = await launch(userData, { REVIVE_TEST_PUBLIC_HOST: publicHost })
  const win = await app.firstWindow()
  await win.getByTestId('welcome-en').click()
  await expect(win.getByTestId('prereq-continue')).toBeEnabled({ timeout: 30_000 })
  await win.getByTestId('prereq-continue').click()
  await stubFolderDialog(app, sampleFolder())
  await win.getByTestId('folder-pick').click()
  await win.getByTestId('scan-start').click()
  await expect(win.getByTestId('scan-result')).toContainText('Found 2 projects.', { timeout: 30_000 })
  await win.getByTestId('nav-settings').click()
  await win.getByTestId('sharing-switch').click()
  await expect(win.getByTestId('sharing-switch')).toHaveAttribute('aria-checked', 'true')
  const hostPort = JSON.parse(readFileSync(join(userData, 'host.json'), 'utf8')).port as number
  const proxy = await startTlsProxy(hostPort, proxyPort)

  await win.getByTestId('pair-start').click()
  const code = (await win.getByTestId('pairing-code').textContent())!.trim()
  const browser = await webkit.launch()
  const context = await browser.newContext({ ...devices['iPhone 15'], ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await page.goto(`https://${publicHost}/`)
  await page.getByTestId('web-pair-code').fill(code)
  await page.getByTestId('web-pair-name').fill('Test iPhone')
  await page.getByTestId('web-pair-submit').click()
  await expect(win.getByTestId('pairing-request')).toContainText('Allow Test iPhone to connect?', { timeout: 10_000 })
  await win.getByTestId('pairing-allow').click()

  await expect(page.getByTestId('project-card')).toHaveCount(2, { timeout: 15_000 })
  const cookie = (await context.cookies()).find((c) => c.name === 'revive_device')!
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' })
  expect(await page.evaluate(() => document.cookie)).not.toContain('revive_device')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)

  await page.locator('[data-project="bakery-site"]').getByTestId('card-action').click()
  await page.getByTestId('terminal-open-shell').click()
  await expect(page.getByTestId('key-row')).toBeVisible()
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type('cat -vt\n')
  await expect.poll(() => page.locator('.xterm-rows').innerText(), { timeout: 10_000 }).toContain('cat -vt')
  await page.waitForTimeout(400)
  // On a small iPhone screen nothing may sit on top of the key row (a real tap has to reach it).
  const row = (await page.getByTestId('key-row').boundingBox())!
  const onTop = await page.evaluate(([x, y]) => (document.elementFromPoint(x!, y!) as HTMLElement | null)?.closest('[data-testid="key-row"]') !== null, [row.x + row.width / 2, row.y + row.height / 2])
  expect(onTop).toBe(true)
  for (const k of ['esc', 'tab', 'up', 'down', 'right', 'left', 'enter']) await page.getByTestId(`key-${k}`).tap()
  await expect.poll(() => page.locator('.xterm-rows').innerText(), { timeout: 10_000 }).toMatch(/\^\[\^I\^\[[[O]A\^\[[[O]B\^\[[[O]C\^\[[[O]D/)

  await win.getByTestId('nav-projects').click()
  await win.getByTestId('nav-settings').click()
  await win.getByTestId('device-row').filter({ hasText: 'Test iPhone' }).getByTestId('device-revoke').click()
  await win.getByTestId('device-revoke-confirm').click()
  await expect(page.getByTestId('web-signed-out')).toBeVisible({ timeout: 3000 })

  await browser.close()
  await proxy.close()
  await app.close()
})
