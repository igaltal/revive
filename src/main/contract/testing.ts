import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Manifest } from '@shared/manifest'
import { createCore, SKIPPED_GUARD } from '../app/core'
import { fakeAdapter } from '../scanner/fake-adapter'
import { childBackend } from '../services/sessions/child-backend'
import type { Core, Platform } from './handlers'

/** Test support for the contract suites: the real core over a temp folder, without Electron. */

const NODE = JSON.stringify(process.execPath)

/** A dev server that prints `total` lines (about 60 bytes each) in batches, then serves. */
export const NOISY = `
const total = Number(process.argv[2] || 20000)
let n = 0
const batch = () => {
  for (let i = 0; i < 200; i++) console.log('compiling module ' + (++n) + ' ' + 'x'.repeat(40))
  if (n < total) return setTimeout(batch, 4)
  const s = require('http').createServer((q, r) => r.end('ok')).listen(0, '127.0.0.1', () => console.log('Local: http://localhost:' + s.address().port + '/'))
}
batch()
`

export const until = async (what: string, ok: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (ok()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`timed out waiting for ${what}`)
}

export const platform: Platform = {
  pickFolder: async () => null,
  openExternal: async () => {},
  preview: { show: () => {}, hide: () => {}, cover: async () => {}, uncover: () => {}, reload: () => {}, openInBrowser: async () => {} }
}

/** The real core, a copy of the fixture folder with two extra projects, and the offline agent. */
export function makeCore(): { core: Core; folder: string } {
  const root = mkdtempSync(join(tmpdir(), 'revive-parity-'))
  const folder = join(root, 'projects')
  cpSync('fixtures/sample-folder', folder, { recursive: true })
  mkdirSync(join(folder, 'noisy'))
  writeFileSync(join(folder, 'noisy/noisy.cjs'), NOISY)
  mkdirSync(join(folder, 'echo'))
  writeFileSync(join(folder, 'echo/README.txt'), 'echo')
  const manifest = JSON.parse(readFileSync('fixtures/sample-folder.manifest.json', 'utf8')) as Manifest
  const base = manifest.projects[0]!
  manifest.projects.push(
    { ...structuredClone(base), id: 'noisy', name: 'Noisy', path: 'noisy', run: { ...base.run, dev: `${NODE} noisy.cjs` } },
    { ...structuredClone(base), id: 'flood', name: 'Flood', path: 'noisy', run: { ...base.run, dev: `${NODE} noisy.cjs 70000` } },
    { ...structuredClone(base), id: 'echo', name: 'Echo', path: 'echo', run: { ...base.run, dev: `${NODE} -e "process.stdin.on('data', (d) => console.log('got:' + d))"` } }
  )
  const manifestFile = join(root, 'manifest.json')
  writeFileSync(manifestFile, JSON.stringify(manifest))
  const core = createCore({
    userData: join(root, 'user-data'),
    backend: childBackend,
    staticServer: { file: process.execPath, args: [resolve('src/main/services/runner/static-server.ts')], env: {} },
    adapter: fakeAdapter(manifestFile),
    guard: SKIPPED_GUARD,
    runnerTiming: { probeAfterMs: 200, probeEveryMs: 100 }
  })
  return { core, folder }
}

