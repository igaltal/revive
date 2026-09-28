/// <reference lib="dom" />
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { freshUserData, killTestTmux, launch, stubFolderDialog } from './helpers'

/**
 * The look, on record: Home, the gallery, a project page and a terminal, in
 * Scenic and Paper, English and Hebrew, 1440 and 390 wide. Both "devices"
 * are browsers paired to a real Host (the built app), each with its own look.
 * Pictures go to screenshots/m10 (not in git).
 */
const OUT = resolve(process.env['REVIVE_SHOTS_DIR'] ?? 'screenshots/m10')
test.afterAll(() => killTestTmux())

const DESKTOP: BrowserContextOptions = { viewport: { width: 1440, height: 1024 } }
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
}

async function pair(browser: Browser, win: Page, origin: string, name: string, opts: BrowserContextOptions) {
  await win.getByTestId('pair-start').click()
  const code = (await win.getByTestId('pairing-code').textContent())!.trim()
  const page = await (await browser.newContext(opts)).newPage()
  await page.goto(origin)
  await page.getByTestId('web-pair-code').fill(code)
  await page.getByTestId('web-pair-name').fill(name)
  await page.getByTestId('web-pair-submit').click()
  const ask = win.getByTestId('pairing-request')
  await expect(ask).toContainText(`Allow ${name} to connect?`, { timeout: 10_000 })
  await ask.getByTestId('pairing-allow').click()
  // Home is the first screen on a device connected to a Host.
  await expect(page.getByTestId('home')).toBeVisible({ timeout: 15_000 })
  return page
}

/** Through the Customize screen, as a user would: the look, and for Scenic the approved design's dusk. */
async function setLook(page: Page, theme: 'scenic' | 'paper', scene: 'dusk' | 'dawn' | 'day' | 'night' = 'dusk') {
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('open-customize').click()
  await page.locator(`[data-testid="set-theme"] [data-value="${theme}"]`).click()
  await page.locator(`[data-testid="set-scene"] [data-value="${scene}"]`).click()
  // The other device waits a long time between its pictures: no screensaver meanwhile.
  await page.getByTestId('set-idle').selectOption('0')
  await page.getByTestId('customize-save').click()
  await expect(page.getByTestId('customize-unsaved')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
}

async function setLanguage(page: Page, lang: 'en' | 'he') {
  await page.getByTestId('nav-settings').click()
  await page.getByTestId(`lang-${lang}`).first().click()
  await expect(page.locator('html')).toHaveAttribute('dir', lang === 'he' ? 'rtl' : 'ltr')
}

async function shoot(page: Page, name: string) {
  // Fonts, the scene and the vitals settle; no animation mid-frame matters at this rate.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
}

async function fourScreens(page: Page, prefix: string) {
  await page.getByTestId('nav-home').click()
  await expect(page.getByTestId('home-tile')).toHaveCount(4, { timeout: 10_000 }).catch(async () => expect(page.getByTestId('home-tile')).toHaveCount(8))
  await expect(page.getByTestId('vitals-gauge').or(page.getByTestId('home-stats')).first()).toBeVisible({ timeout: 10_000 })
  await shoot(page, `${prefix}-1-home`)
  await page.getByTestId('nav-projects').click()
  await expect(page.getByTestId('project-card')).toHaveCount(8)
  await shoot(page, `${prefix}-2-gallery`)
  await page.locator('[data-project="bakery-site"] h2 button').click()
  await expect(page.getByTestId('terminal-open')).toBeVisible()
  await shoot(page, `${prefix}-3-project`)
  await page.getByTestId('terminal-open-shell').click()
  await expect(page.getByTestId('terminal-view')).toBeVisible()
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type('echo "Revive M10"\n')
  await expect.poll(() => page.locator('.xterm-rows').innerText(), { timeout: 10_000 }).toContain('Revive M10')
  await shoot(page, `${prefix}-4-terminal`)
  // Back to the project (on a phone the terminal has the whole screen, without the tab bar).
  await page.getByTestId('terminal-back').click()
  await expect(page.getByTestId('terminal-open')).toBeVisible()
}

test('screenshots: every screen, both looks, both languages, desktop and phone', async ({ browser }) => {
  test.setTimeout(900_000)
  mkdirSync(OUT, { recursive: true })
  const userData = freshUserData()
  const folder = join(mkdtempSync(join(tmpdir(), 'revive-folder-')), 'my-ai-projects')
  cpSync('fixtures/showcase-folder', folder, { recursive: true })
  const app = await launch(userData, { REVIVE_TEST_AGENT: resolve('fixtures/showcase-folder.manifest.json') })
  const win = await app.firstWindow()
  await win.getByTestId('welcome-en').click()
  await expect(win.getByTestId('prereq-continue')).toBeEnabled({ timeout: 30_000 })
  await win.getByTestId('prereq-continue').click()
  await stubFolderDialog(app, folder)
  await win.getByTestId('folder-pick').click()
  await win.getByTestId('scan-start').click()
  await expect(win.getByTestId('scan-result')).toContainText('Found 8 projects.', { timeout: 60_000 })
  // Local mode stays in Paper.
  await expect(win.locator('html')).toHaveAttribute('data-theme', 'paper')
  await win.getByTestId('nav-settings').click()
  await win.getByTestId('sharing-switch').click()
  await expect(win.getByTestId('sharing-switch')).toHaveAttribute('aria-checked', 'true')
  const port = JSON.parse(readFileSync(join(userData, 'host.json'), 'utf8')).port as number
  const origin = `http://127.0.0.1:${port}`

  const desk = await pair(browser, win, origin, 'MacBook', DESKTOP)
  const phone = await pair(browser, win, origin, 'Noa phone', PHONE)
  // Connected devices start in Scenic.
  await expect(desk.locator('html')).toHaveAttribute('data-theme', 'scenic')
  await expect(phone.locator('html')).toHaveAttribute('data-theme', 'scenic')

  for (const [page, device] of [
    [desk, '1440'],
    [phone, '390']
  ] as const) {
    for (const theme of ['scenic', 'paper'] as const) {
      await setLook(page, theme)
      for (const lang of ['en', 'he'] as const) {
        await setLanguage(page, lang)
        await fourScreens(page, `${device}-${theme}-${lang}`)
      }
    }
  }

  // Each device keeps its own look: the phone ended in Paper, the MacBook goes back to Scenic, and the phone doesn't follow.
  await setLook(desk, 'scenic')
  await phone.reload()
  await expect(phone.getByTestId('home')).toBeVisible({ timeout: 15_000 })
  await expect(phone.locator('html')).toHaveAttribute('data-theme', 'paper')
  await desk.reload()
  await expect(desk.getByTestId('home')).toBeVisible({ timeout: 15_000 })
  await expect(desk.locator('html')).toHaveAttribute('data-theme', 'scenic')
  // And the Host's own window keeps its own too.
  await expect(win.locator('html')).toHaveAttribute('data-theme', 'scenic') // sharing: Scenic by default

  // The four skies on the desktop Home, in English.
  await setLanguage(desk, 'en')
  for (const scene of ['dawn', 'day', 'dusk', 'night'] as const) {
    await setLook(desk, 'scenic', scene)
    await desk.getByTestId('nav-home').click()
    await expect(desk.getByTestId('scene-backdrop')).toHaveAttribute('data-sky', scene)
    await shoot(desk, `sky-${scene}`)
  }
  await app.close()
})
