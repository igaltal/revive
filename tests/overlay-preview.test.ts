import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(p) && !p.endsWith('.test.tsx') ? [p] : []
  })
}

/** Anything that draws over the page: it would sit under the native preview unless it hides it. */
const OVERLAY = /role=["'](?:dialog|alertdialog|menu|listbox)["']|aria-modal|<(?:dialog|Sheet)\b|popover=/

describe('overlays and the native preview', () => {
  it('every dialog, menu or sheet goes through useOverlay', () => {
    const offenders = files('src/renderer').filter((f) => {
      const src = readFileSync(f, 'utf8')
      return OVERLAY.test(src) && !/\buseOverlay\(/.test(src)
    })
    expect(offenders).toEqual([])
  })

  it('there is at least one, so the check means something', () => {
    expect(files('src/renderer').some((f) => OVERLAY.test(readFileSync(f, 'utf8')))).toBe(true)
  })
})
