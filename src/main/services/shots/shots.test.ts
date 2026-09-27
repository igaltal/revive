import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseShotPath } from '@shared/assets'
import { listShots, resolveAssetRequest, saveShot } from './shots'

describe('project pictures', () => {
  it('are saved under .revive/shots and handed out as paths, not files', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'revive-shots-'))
    const path = await saveShot(folder, 'bakery-site', Buffer.from('png'))
    expect(path).toMatch(/^\/shots\/bakery-site\.png\?v=\d+$/)
    expect(await listShots(folder, ['bakery-site', 'habit-counter'])).toEqual({ 'bakery-site': path })
    expect(resolveAssetRequest(folder, '/shots/bakery-site.png', new Set(['bakery-site']))).toBe(join(folder, '.revive/shots/bakery-site.png'))
  })

  it('serve nothing outside .revive/shots and nothing for unknown projects', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'revive-shots-'))
    writeFileSync(join(folder, 'secret.png'), 'x')
    await saveShot(folder, 'a', Buffer.from('png'))
    const ids = new Set(['a'])
    expect(resolveAssetRequest(folder, '/shots/b.png', ids)).toBeNull()
    expect(resolveAssetRequest(folder, '/shots/..%2Fsecret.png', new Set(['../secret']))).toBeNull()
    expect(resolveAssetRequest(folder, '/secret.png', ids)).toBeNull()
    expect(parseShotPath('/shots/%2E%2E.png')).toBeNull()
    expect(await saveShot(folder, '../evil', Buffer.from('png'))).toBeNull()
  })
})
