import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveInside } from './static-server'

function site() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'revive-static-')))
  writeFileSync(join(root, 'index.html'), '<h1>Bakery</h1>')
  writeFileSync(join(root, '.env'), 'MAPS_KEY=secret-value')
  mkdirSync(join(root, 'img'))
  writeFileSync(join(root, 'img/logo.svg'), '<svg/>')
  symlinkSync('/etc', join(root, 'escape'))
  return root
}

describe('Revive static server', () => {
  it('serves the folder but never hidden files, parent folders or links out', async () => {
    const root = site()
    expect(await resolveInside(root, '/')).toBe(join(root, 'index.html'))
    expect(await resolveInside(root, '/img/logo.svg?x=1')).toBe(join(root, 'img/logo.svg'))
    expect(await resolveInside(root, '/.env')).toBeNull()
    expect(await resolveInside(root, '/../etc/passwd')).toBeNull()
    expect(await resolveInside(root, '/%2e%2e/etc/passwd')).toBeNull()
    expect(await resolveInside(root, '/escape/hosts')).toBeNull()
  })

  it('runs as its own process and says where it is', async () => {
    const root = site()
    const child = spawn(process.execPath, ['src/main/services/runner/static-server.ts', root, '0'], { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      const url = await new Promise<string>((resolve, reject) => {
        child.stdout.on('data', (d: Buffer) => {
          const m = /at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(d.toString())
          if (m) resolve(m[1]!)
        })
        child.on('exit', () => reject(new Error('exited')))
      })
      expect(await (await fetch(url)).text()).toBe('<h1>Bakery</h1>')
      expect((await fetch(`${url}.env`)).status).toBe(404)
    } finally {
      child.kill('SIGTERM')
    }
  })
})
