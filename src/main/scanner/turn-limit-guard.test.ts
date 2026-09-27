import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GuardState } from '@shared/guard'
import type { Exec } from '../exec'
import { judgeProbe, TurnLimitGuard, type ProbeFiles } from './turn-limit-guard'

const files: ProbeFiles = { first: 'start.txt', second: 'next-ab12.txt', third: 'last-cd34.txt' }
const read = (name: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: `/tmp/x/${name}` } }] } })
const result = (subtype: string, turns = 2) => JSON.stringify({ type: 'result', subtype, is_error: subtype !== 'success', num_turns: turns, result: '' })

describe('turn limit check: the verdict', () => {
  it('enforced: stopped after the first read', () => {
    // The shape Claude Code 2.1.283 actually produced on this machine.
    expect(judgeProbe([read('start.txt'), result('error_max_turns')], '', files).verdict).toBe('enforced')
  })
  it('not enforced: read further, finished normally, or the flag is unknown', () => {
    expect(judgeProbe([read('start.txt'), read('next-ab12.txt'), result('error_max_turns', 3)], '', files).verdict).toBe('not_enforced')
    expect(judgeProbe([read('start.txt'), result('success')], '', files).verdict).toBe('not_enforced')
    expect(judgeProbe([], "error: unknown option '--max-turns'", files).verdict).toBe('not_enforced')
  })
  it('inconclusive: signed out, or no tool used at all', () => {
    expect(judgeProbe([], 'Invalid API key · Please run /login', files)).toMatchObject({ verdict: 'inconclusive', signedOut: true })
    expect(judgeProbe([result('success', 1)], '', files).verdict).toBe('inconclusive')
  })
})

describe('turn limit guard', () => {
  const exec =
    (version = '2.1.283'): Exec =>
    async (_file, args) =>
      args[0] === '--version' ? { code: 0, stdout: `${version} (Claude Code)`, stderr: '' } : { code: 0, stdout: '{"loggedIn":true}', stderr: '' }

  it('checks once per Claude Code version, then trusts the saved verdict', async () => {
    const cache = join(mkdtempSync(join(tmpdir(), 'revive-guard-')), 'guard.json')
    let probes = 0
    const probe = async () => (probes++, { verdict: 'enforced' as const, detail: [] })
    const seen: GuardState[] = []
    const g = new TurnLimitGuard(cache, exec(), (s) => seen.push(s), probe)
    expect((await g.ensure()).state).toBe('ok')
    expect((await new TurnLimitGuard(cache, exec(), () => {}, probe).ensure()).state).toBe('ok')
    expect(probes).toBe(1)
    expect((await new TurnLimitGuard(cache, exec('2.2.0'), () => {}, probe).ensure()).state).toBe('ok')
    expect(probes).toBe(2)
    expect(seen.map((s) => s.state)).toEqual(['checking', 'ok'])
  })

  it('fails loudly and stays failed for that version', async () => {
    const cache = join(mkdtempSync(join(tmpdir(), 'revive-guard-')), 'guard.json')
    const probe = async () => ({ verdict: 'not_enforced' as const, detail: ['Claude kept going past the one-turn limit.'] })
    const g = new TurnLimitGuard(cache, exec(), () => {}, probe)
    const errors: unknown[] = []
    const orig = console.error
    console.error = (...a: unknown[]) => void errors.push(a)
    try {
      expect(await g.ensure()).toMatchObject({ state: 'failed', version: '2.1.283' })
    } finally {
      console.error = orig
    }
    expect(errors).toHaveLength(1)
    const again = new TurnLimitGuard(cache, exec(), () => {}, async () => ({ verdict: 'enforced' as const, detail: [] }))
    expect((await again.ensure()).state).toBe('failed')
    expect((await again.ensure(true)).state).toBe('ok')
  })

  it("doesn't spend anything while signed out", async () => {
    const cache = join(mkdtempSync(join(tmpdir(), 'revive-guard-')), 'guard.json')
    let probes = 0
    const signedOut: Exec = async (_f, args) => (args[0] === '--version' ? { code: 0, stdout: '2.1.283', stderr: '' } : { code: 1, stdout: '{"loggedIn":false}', stderr: '' })
    const g = new TurnLimitGuard(cache, signedOut, () => {}, async () => (probes++, { verdict: 'enforced' as const, detail: [] }))
    expect((await g.ensure()).state).toBe('unchecked')
    expect(probes).toBe(0)
  })
})
