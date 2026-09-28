import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { offerMoveToApplications, type MoveDeps } from './install-location'
import { bundledTmux, resourcePath, tmuxSocketName } from './paths'
import { findTmux } from './services/sessions/tmux-backend'

function deps(over: Partial<MoveDeps> = {}) {
  const calls = { ask: 0, move: 0 }
  const d: MoveDeps = {
    packaged: true,
    inApplications: () => false,
    move: () => (calls.move++, true),
    ask: async () => (calls.ask++, { response: 0, checkboxChecked: false }),
    file: join(mkdtempSync(join(tmpdir(), 'revive-install-')), 'install.json'),
    skip: false,
    ...over
  }
  return { d, calls }
}

describe('moving to Applications', () => {
  it('offers it when launched from outside /Applications, and moves on yes', async () => {
    const { d, calls } = deps()
    expect(await offerMoveToApplications(d)).toBe(true)
    expect(calls).toEqual({ ask: 1, move: 1 })
  })

  it('never asks in development, from /Applications, or in the packaged-app test', async () => {
    for (const over of [{ packaged: false }, { inApplications: () => true }, { skip: true }]) {
      const { d, calls } = deps(over)
      expect(await offerMoveToApplications(d)).toBe(false)
      expect(calls.ask).toBe(0)
    }
  })

  it('"Not now" asks again next time; "Don\'t ask again" is remembered', async () => {
    const later = deps({ ask: async () => ({ response: 1, checkboxChecked: false }) })
    await offerMoveToApplications(later.d)
    await offerMoveToApplications(later.d)
    expect(later.calls.move).toBe(0)

    let asked = 0
    const never = deps({ ask: async () => (asked++, { response: 1, checkboxChecked: true }) })
    await offerMoveToApplications(never.d)
    await offerMoveToApplications(never.d)
    expect(asked).toBe(1)
    expect(JSON.parse(readFileSync(never.d.file, 'utf8'))).toEqual({ moveToApplications: 'declined' })
  })

  it('a failed move keeps Revive running where it is', async () => {
    const { d } = deps({
      move: () => {
        throw new Error('permission denied')
      }
    })
    expect(await offerMoveToApplications(d)).toBe(false)
  })
})

describe('the bundled tmux', () => {
  it('comes first, then a system one; REVIVE_TMUX still overrides', () => {
    const res = mkdtempSync(join(tmpdir(), 'revive-res-'))
    expect(bundledTmux(true, res)).toBeNull()
    expect(resourcePath('bin/tmux', true, res)).toBe(join(res, 'bin/tmux'))
    const fakeBundled = process.execPath // any file that exists
    expect(findTmux({ PATH: '/usr/bin' }, fakeBundled)).toBe(fakeBundled)
    expect(findTmux({ PATH: '/usr/bin', REVIVE_TMUX: 'none' }, fakeBundled)).toBeNull()
    expect(findTmux({ PATH: '', REVIVE_TMUX: '/nope/tmux' }, fakeBundled)).toBeNull()
    expect(findTmux({ PATH: '/nonexistent' }, '/nope/tmux')).not.toBe('/nope/tmux')
  })

  it('a Revive on its own data folder gets its own tmux socket, never the real one', () => {
    expect(tmuxSocketName(undefined)).toBe('revive')
    const a = tmuxSocketName('/tmp/a')
    expect(a).toMatch(/^revive-[0-9a-f]{10}$/)
    expect(tmuxSocketName('/tmp/a')).toBe(a)
    expect(tmuxSocketName('/tmp/b')).not.toBe(a)
  })
})
