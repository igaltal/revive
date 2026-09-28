/// <reference lib="dom" />
import { expect, test, type Browser, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshUserData, killTestTmux, launch, sampleFolder, stubFolderDialog } from './helpers'

test.afterAll(() => killTestTmux())

/** A phone: 390 px wide, touch, mobile. */
const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
}

/** A real Host: the built app, a folder read, sharing on. */
async function startHost(): Promise<{ app: ElectronApplication; win: Page; origin: string; userData: string }> {
  const userData = freshUserData()
  const app = await launch(userData)
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
  const port = JSON.parse(readFileSync(join(userData, 'host.json'), 'utf8')).port as number
  return { app, win, origin: `http://127.0.0.1:${port}`, userData }
}

async function pairPhone(browser: Browser, host: { win: Page; origin: string }, name: string) {
  await host.win.getByTestId('pair-start').click()
  const code = (await host.win.getByTestId('pairing-code').textContent())!.trim()
  const context = await browser.newContext(PHONE)
  const page = await context.newPage()
  await page.goto(host.origin)
  await page.getByTestId('web-pair-code').fill(code)
  await page.getByTestId('web-pair-name').fill(name)
  await page.getByTestId('web-pair-submit').click()
  await expect(page.getByTestId('web-pair-waiting')).toBeVisible()
  // Nothing happens until the Host user allows it.
  const ask = host.win.getByTestId('pairing-request')
  await expect(ask).toContainText(`Allow ${name} to connect?`, { timeout: 10_000 })
  await ask.getByTestId('pairing-allow').click()
  return { context, page }
}

test('the phone: pair in the browser, approve on the Host, run a project, use the terminal, then revoke', async ({ browser }) => {
  test.setTimeout(120_000)
  const host = await startHost()
  const { context, page } = await pairPhone(browser, host, 'Noa phone')

  // The same app, over the Host's WebSocket: the gallery in one column at 390 px.
  const cards = page.getByTestId('project-card')
  await expect(cards).toHaveCount(2, { timeout: 15_000 })
  const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()]
  expect(a!.width).toBeGreaterThan(330)
  expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  // The device token is an HttpOnly, Secure, SameSite=Strict cookie that no page script can read.
  // (All cookies: filtering by an http:// URL would leave Secure cookies out.)
  const cookie = (await context.cookies()).find((c) => c.name === 'revive_device')!
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' })
  expect(await page.evaluate(() => document.cookie)).not.toContain('revive_device')
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(stored).not.toContain(cookie.value)

  // Unsupported here: no native preview, no folder dialog, no Host controls.
  await page.locator('[data-project="bakery-site"]').getByTestId('card-action').click()
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-status', 'running', { timeout: 30_000 })
  await expect(page.getByTestId('preview-remote')).toContainText('Preview runs on')
  await expect(page.getByTestId('preview-frame')).toHaveCount(0)
  await expect(page.getByTestId('preview-open')).toHaveCount(0)

  // A terminal on the phone, with the key row. `cat -vt` shows exactly which bytes arrived (tabs as ^I).
  await page.getByTestId('terminal-open-shell').click()
  await expect(page.getByTestId('key-row')).toBeVisible()
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type('cat -vt\n')
  await expect.poll(() => page.locator('.xterm-rows').innerText(), { timeout: 10_000 }).toContain('cat -vt')
  await page.waitForTimeout(400)
  for (const k of ['esc', 'tab', 'up', 'down', 'right', 'left', 'enter']) await page.getByTestId(`key-${k}`).tap()
  // Arrows follow the terminal's cursor mode (ESC [ A normally, ESC O A in application mode). A shell
  // prompt can leave that mode on for a moment after cat starts, so either form is right.
  await expect.poll(() => page.locator('.xterm-rows').innerText(), { timeout: 10_000 }).toMatch(/\^\[\^I\^\[[[O]A\^\[[[O]B\^\[[[O]C\^\[[[O]D/)
  // Ctrl then "d": end of input, so cat stops and the shell prompt comes back.
  await page.getByTestId('key-ctrl').tap()
  await expect(page.getByTestId('key-ctrl')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.type('d')
  await expect(page.getByTestId('key-ctrl')).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.type('echo cat-ended-$((6*7))\n')
  await expect.poll(() => page.locator('.xterm-rows').innerText(), { timeout: 10_000 }).toContain('cat-ended-42')
  // Bigger text for a small screen.
  const before = Number(await page.getByTestId('terminal-view').getAttribute('data-font-size'))
  await page.getByTestId('font-larger').tap()
  await expect(page.getByTestId('terminal-view')).toHaveAttribute('data-font-size', String(before + 1))

  // The service worker keeps the app shell, and nothing else: no API answers, pictures or terminal output.
  const cached = await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    const urls: string[] = []
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(new URL(r.url).pathname)
    return urls
  })
  expect(cached.length).toBeGreaterThan(5)
  expect(cached.every((u) => u === '/' || u === '/manifest.webmanifest' || u.startsWith('/icons/') || u.startsWith('/assets/'))).toBe(true)
  expect(cached.some((u) => /shots|pair|whoami|logout|\/ws/.test(u))).toBe(false)

  // Revoke on the Host: the phone is signed out at once.
  await host.win.getByTestId('nav-projects').click()
  await host.win.getByTestId('nav-settings').click()
  await host.win.getByTestId('device-row').filter({ hasText: 'Noa phone' }).getByTestId('device-revoke').click()
  await host.win.getByTestId('device-revoke-confirm').click()
  await expect(page.getByTestId('web-signed-out')).toContainText('This device was signed out from', { timeout: 3000 })
  await expect(page.getByTestId('web-pair')).toBeVisible()
  // Its dead cookie is gone after the next request.
  await page.reload()
  await expect(page.getByTestId('web-pair')).toBeVisible()
  expect((await context.cookies()).some((c) => c.name === 'revive_device')).toBe(false)

  // The Host goes away: a clear screen with its name and a retry, not a blank page.
  const { context: c2, page: p2 } = await pairPhone(browser, host, 'Second phone')
  await expect(p2.getByTestId('project-card')).toHaveCount(2, { timeout: 15_000 })
  await p2.evaluate(() => navigator.serviceWorker.ready)
  await host.app.close()
  await p2.reload()
  await expect(p2.getByTestId('web-offline')).toContainText("can't reach", { timeout: 15_000 })
  await expect(p2.getByTestId('web-retry')).toBeVisible()
  await c2.close()
  await context.close()
})

test('in Hebrew at phone size: right to left, nothing wider than the screen', async ({ browser }) => {
  const host = await startHost()
  const { context, page } = await pairPhone(browser, host, 'Hebrew phone')
  await expect(page.getByTestId('project-card')).toHaveCount(2, { timeout: 15_000 })
  await page.getByTestId('lang-he').click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByTestId('nav-history')).toHaveText('היסטוריה')
  for (const route of ['nav-projects', 'nav-history', 'nav-settings']) {
    await page.getByTestId(route).click()
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(390)
  }
  // The Host keeps its own language: the phone's choice is the phone's.
  await expect(host.win.locator('html')).toHaveAttribute('dir', 'ltr')
  await context.close()
  await host.app.close()
})
