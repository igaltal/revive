import { describe, expect, it } from 'vitest'
import type { Exec, ExecResult } from './exec'
import { checkPrereqs, parseAuthStatus } from './prereq'
import { mergePaths, parseShellPath } from './shell-env'

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '' })
const missing: ExecResult = { code: 127, stdout: '', stderr: '' }

function fakeExec(table: Record<string, ExecResult>): Exec & { calls: string[] } {
  const calls: string[] = []
  const fn = (async (file: string, args: string[]) => {
    const key = [file, ...args].join(' ')
    calls.push(key)
    return table[key] ?? missing
  }) as Exec & { calls: string[] }
  fn.calls = calls
  return fn
}

describe('prerequisite check', () => {
  it('reports everything installed and signed in', async () => {
    const exec = fakeExec({
      'claude --version': ok('2.1.282 (Claude Code)\n'),
      'claude auth status --json': ok('{"loggedIn": true, "email": "noa@example.com"}'),
      '/usr/bin/which git': ok('/opt/homebrew/bin/git\n'),
      '/opt/homebrew/bin/git --version': ok('git version 2.47.1\n'),
      'node --version': ok('v24.1.0\n')
    })
    const r = await checkPrereqs(exec)
    expect(r.claude).toEqual({ installed: true, version: '2.1.282', signedIn: 'yes' })
    expect(r.git).toEqual({ installed: true, version: '2.47.1' })
    expect(r.node.version).toBe('24.1.0')
    expect(r.codex.installed).toBe(false)
    expect(JSON.stringify(r)).not.toContain('noa@example.com')
  })

  it('does not run the git stub when developer tools are missing', async () => {
    const exec = fakeExec({ '/usr/bin/which git': ok('/usr/bin/git\n'), '/usr/bin/xcode-select -p': { code: 2, stdout: '', stderr: '' } })
    const r = await checkPrereqs(exec)
    expect(r.git.installed).toBe(false)
    expect(exec.calls).not.toContain('/usr/bin/git --version')
  })

  it('does not ask about sign-in when Claude Code is missing', async () => {
    const exec = fakeExec({})
    const r = await checkPrereqs(exec)
    expect(r.claude).toEqual({ installed: false, version: null, signedIn: 'unknown' })
    expect(exec.calls).not.toContain('claude auth status --json')
  })

  it('reads only loggedIn from auth status', () => {
    expect(parseAuthStatus('{"loggedIn": false}')).toBe('no')
    expect(parseAuthStatus('not json')).toBe('unknown')
    expect(parseAuthStatus('{"other": 1}')).toBe('unknown')
  })
})

describe('shell PATH', () => {
  it('extracts the PATH between markers, ignoring shell noise', () => {
    expect(parseShellPath('Welcome!\n__REVIVE_PATH__/a:/b__REVIVE_PATH__')).toBe('/a:/b')
    expect(parseShellPath('nothing here')).toBeNull()
  })

  it('merges without duplicates, keeping order', () => {
    expect(mergePaths('/a:/b', '/b:/c', null, '/a:/d')).toBe('/a:/b:/c:/d')
  })
})
