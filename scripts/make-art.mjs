// Renders the app icon and the disk image background from SVG (Playwright's Chromium),
// then makes build/icon.icns and build/background.tiff (with its Retina size).
// Run: node scripts/make-art.mjs   (outputs are committed; run again only to change the art)
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BUILD = 'build'
const TMP = join('.cache', 'art')
mkdirSync(TMP, { recursive: true })

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a5c"/><stop offset="1" stop-color="#d9480f"/></linearGradient>
    <radialGradient id="shine" cx="0.5" cy="0.1" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#5a1a00" flood-opacity="0.35"/></filter>
  </defs>
  <g filter="url(#s)">
    <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#g)"/>
    <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#shine)"/>
  </g>
  <circle cx="512" cy="512" r="232" fill="none" stroke="#fff" stroke-width="64"/>
  <circle cx="512" cy="512" r="70" fill="#fff"/>
</svg>`

const W = 660
const H = 420
const background = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f5f0"/><stop offset="1" stop-color="#ece8df"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="${W / 2}" y="64" text-anchor="middle" font-family="-apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif" font-size="22" font-weight="600" fill="#1b1a17">Install Revive</text>
  <text x="${W / 2}" y="92" text-anchor="middle" font-family="-apple-system, 'Helvetica Neue', sans-serif" font-size="14" fill="#6b675e">Drag Revive onto the Applications folder</text>
  <g fill="none" stroke="#d9480f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M262 212 C 300 188, 360 188, 398 212"/>
    <path d="M384 196 L 400 214 L 378 222"/>
  </g>
  <text x="${W / 2}" y="386" text-anchor="middle" font-family="-apple-system, 'Helvetica Neue', sans-serif" font-size="12" fill="#8a857a">Then open Revive from Applications or Launchpad.</text>
</svg>`

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
async function render(svg, w, h, file) {
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
  await page.locator('svg').screenshot({ path: file, omitBackground: true })
}
await render(ICON, 1024, 1024, join(TMP, 'icon-1024.png'))
await render(background(1), W, H, join(TMP, 'background.png'))
await render(background(2), W * 2, H * 2, join(TMP, 'background@2x.png'))
await browser.close()

// icon.icns from every size macOS asks for.
const set = join(TMP, 'icon.iconset')
rmSync(set, { recursive: true, force: true })
mkdirSync(set)
for (const size of [16, 32, 128, 256, 512]) {
  execFileSync('sips', ['-z', String(size), String(size), join(TMP, 'icon-1024.png'), '--out', join(set, `icon_${size}x${size}.png`)], { stdio: 'ignore' })
  execFileSync('sips', ['-z', String(size * 2), String(size * 2), join(TMP, 'icon-1024.png'), '--out', join(set, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' })
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', join(BUILD, 'icon.icns')])
execFileSync('cp', [join(TMP, 'icon-1024.png'), join(BUILD, 'icon.png')])
// One TIFF with both sizes: Finder picks the sharp one on Retina screens.
execFileSync('tiffutil', ['-cathidpicheck', join(TMP, 'background.png'), join(TMP, 'background@2x.png'), '-out', join(BUILD, 'background.tiff')], { stdio: 'ignore' })
writeFileSync(join(TMP, 'done'), new Date().toISOString())
console.log('build/icon.icns, build/icon.png, build/background.tiff')
