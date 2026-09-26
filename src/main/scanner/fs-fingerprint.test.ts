import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walk } from '../fs-walk'
import { diffFingerprints, fingerprint, isClean } from './fs-fingerprint'

function folder() {
  const root = mkdtempSync(join(tmpdir(), 'revive-fp-'))
  mkdirSync(join(root, 'app/src'), { recursive: true })
  mkdirSync(join(root, 'app/node_modules/x'), { recursive: true })
  mkdirSync(join(root, '.revive'), { recursive: true })
  mkdirSync(join(root, 'nested/.git'), { recursive: true })
  writeFileSync(join(root, 'app/src/a.js'), 'a')
  writeFileSync(join(root, 'app/node_modules/x/i.js'), 'dep')
  writeFileSync(join(root, '.revive/manifest.json'), '{}')
  writeFileSync(join(root, 'notes.txt'), 'n')
  return root
}

describe('folder fingerprint', () => {
  it('skips dependencies and .revive, and finds nested repos', async () => {
    const root = folder()
    const { files, repos } = await walk(root)
    expect(files.map((f) => f.rel)).toEqual(['app/src/a.js', 'notes.txt'])
    expect(repos).toEqual(['nested'])
  })

  it('sees additions, removals and edits outside .revive only', async () => {
    const root = folder()
    const before = await fingerprint(root)
    writeFileSync(join(root, '.revive/manifest.json'), '{"changed":true}')
    expect(isClean(diffFingerprints(before, await fingerprint(root)))).toBe(true)

    writeFileSync(join(root, 'new.txt'), 'x')
    rmSync(join(root, 'notes.txt'))
    writeFileSync(join(root, 'app/src/a.js'), 'changed')
    utimesSync(join(root, 'app/src/a.js'), new Date(), new Date(Date.now() + 5000))
    const d = diffFingerprints(before, await fingerprint(root))
    expect(d).toEqual({ added: ['new.txt'], removed: ['notes.txt'], modified: ['app/src/a.js'] })
  })
})
