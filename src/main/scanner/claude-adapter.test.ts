import { describe, expect, it } from 'vitest'
import { buildUnderstandArgs, classifyResult, parseUnderstandOutput, UNDERSTAND_ENV } from './claude-adapter'
import type { UnderstandInput } from './agent-adapter'

const input: UnderstandInput = {
  id: 'bakery-site',
  path: 'bakery-site',
  stack: ['html'],
  commands: { install: null, dev: null },
  digest: { packageName: null, packageDescription: null, title: 'Sunrise Bakery', pageText: 'Fresh bread', readme: null, scripts: {}, dependencies: [], tree: ['index.html'], keys: [] }
}

describe('the understanding call', () => {
  it('has no tools, Revive’s own short instructions, limits and a checked answer shape', () => {
    const args = buildUnderstandArgs([input], 'sonnet')
    const at = (flag: string) => args[args.indexOf(flag) + 1]
    expect(at('--tools')).toBe('')
    expect(at('--system-prompt')).toContain('You never see the files themselves, and you have no tools.')
    expect(at('--model')).toBe('sonnet')
    expect(Number(at('--max-turns'))).toBeLessThanOrEqual(3)
    expect(Number(at('--max-budget-usd'))).toBeLessThanOrEqual(0.5)
    expect(args).toContain('--restricted')
    expect(args).toContain('--no-session-persistence')
    expect(JSON.parse(at('--json-schema')!).properties.projects).toBeTruthy()
    expect(at('-p')).toContain('"title": "Sunrise Bakery"')
    // Extended thinking off: measured four times faster and half the cost, same answer.
    expect(UNDERSTAND_ENV).toEqual({ MAX_THINKING_TOKENS: '0' })
  })

  it('reads the structured answer and its cost', () => {
    const answer = { projects: [{ id: 'bakery-site', name: 'Sunrise Bakery', en: 'A bakery site.', he: 'אתר למאפייה.', keys: [], notes: [] }] }
    const out = parseUnderstandOutput(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.011, structured_output: answer }), '')
    expect(out).toEqual({ ok: true, costUsd: 0.011, projects: answer.projects })
  })

  it('says why when it fails: signed out, a limit, or a bad shape', () => {
    expect(parseUnderstandOutput(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Not logged in · Please run /login' }), '')).toMatchObject({ ok: false, code: 'auth' })
    expect(parseUnderstandOutput(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 0.5 }), '')).toMatchObject({ ok: false, code: 'limit', costUsd: 0.5 })
    expect(parseUnderstandOutput(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { projects: [{ id: 'x' }] } }), '')).toMatchObject({ ok: false, code: 'unknown' })
    expect(classifyResult(null, 'Error: invalid api key sk-ant-api03-SECRETSECRETSECRETSECRET')).toMatchObject({ ok: false, code: 'auth' })
  })
})
