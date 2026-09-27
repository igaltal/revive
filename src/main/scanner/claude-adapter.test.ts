import { describe, expect, it } from 'vitest'
import { buildScanArgs, classifyResult, parseStreamLine, SECRET_FILE_DENY } from './claude-adapter'

describe('scan command line', () => {
  const args = buildScanArgs('haiku')
  const after = (flag: string) => args[args.indexOf(flag) + 1]

  it('runs headless with streamed JSON, the chosen model and hard limits', () => {
    expect(args[0]).toBe('-p')
    expect(args[1]).toContain('Index this folder for Revive')
    expect(after('--output-format')).toBe('stream-json')
    expect(args).toContain('--verbose')
    expect(after('--model')).toBe('haiku')
    expect(after('--max-turns')).toBe('200')
    expect(after('--max-budget-usd')).toBe('3')
  })

  it('has no tool that can run code or search file contents', () => {
    expect(args).toContain('--restricted')
    expect(after('--tools')).toBe('Read,Glob,Write,Edit')
    expect(after('--tools')).not.toMatch(/Bash|Grep/)
    expect(after('--permission-mode')).toBe('dontAsk')
    expect(after('--permission-prompts')).toBe('none')
  })

  it('may write only .revive/manifest.json and never read secret files', () => {
    const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'))
    expect(allowed).toEqual(['Read', 'Glob', 'Edit(.revive/manifest.json)'])
    expect(allowed.some((a) => a.startsWith('Write('))).toBe(false)
    expect(SECRET_FILE_DENY).toEqual(expect.arrayContaining(['Read(.env)', 'Read(.env.*)']))
  })
})

describe('reading the stream', () => {
  const folder = '/private/var/tmp/projects'
  it('reports files read, relative to the folder', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: `${folder}/bakery-site/index.html` } }] } })
    expect(parseStreamLine(line, [folder])).toEqual([{ type: 'event', event: { kind: 'read', path: 'bakery-site/index.html' } }])
  })

  it('reads the final result and cost', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0182515, result: 'done' })
    const [r] = parseStreamLine(line, [folder])
    expect(r).toMatchObject({ type: 'result', costUsd: 0.0182515 })
  })

  it('ignores noise', () => {
    expect(parseStreamLine('not json', [folder])).toEqual([])
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init' }), [folder])).toEqual([])
  })

  it('classifies limits, sign-in problems and unknown failures', () => {
    const base = { type: 'result' as const, costUsd: 0.5, text: '' }
    expect(classifyResult({ ...base, isError: false, subtype: 'success' }, '')).toEqual({ ok: true, costUsd: 0.5 })
    expect(classifyResult({ ...base, isError: true, subtype: 'error_max_turns' }, '')).toMatchObject({ code: 'limit' })
    expect(classifyResult({ ...base, isError: true, subtype: 'error_max_budget_usd' }, '')).toMatchObject({ code: 'limit' })
    expect(classifyResult(null, 'Invalid API key · Please run /login')).toMatchObject({ code: 'auth' })
    const unknown = classifyResult(null, 'boom TOKEN=abc123456')
    expect(unknown).toMatchObject({ code: 'unknown' })
    expect(JSON.stringify(unknown)).not.toContain('abc123456')
  })
})

describe('the description call', () => {
  it('has no tools at all and asks for a checked JSON shape', async () => {
    const { buildDescribeArgs } = await import('./claude-adapter')
    const args = buildDescribeArgs([{ id: 'a', name: 'A', stack: [], draft: 'x', notes: [], keyPurposes: [] }], 'sonnet')
    const after = (flag: string) => args[args.indexOf(flag) + 1]
    expect(after('--tools')).toBe('')
    expect(args).not.toContain('--allowedTools')
    expect(args).toContain('--restricted')
    expect(after('--model')).toBe('sonnet')
    expect(after('--output-format')).toBe('json')
    expect(JSON.parse(after('--json-schema')!).properties.projects.type).toBe('array')
    expect(args[1]).toContain('"draft": "x"')
  })

  it('reads the structured answer and its cost, and rejects anything else', async () => {
    const { parseDescribeOutput } = await import('./claude-adapter')
    const ok = { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.025, result: '', structured_output: { projects: [{ id: 'a', en: 'A bakery site.', he: 'אתר למאפייה.' }] } }
    expect(parseDescribeOutput(JSON.stringify(ok), '')).toEqual({ ok: true, costUsd: 0.025, descriptions: [{ id: 'a', en: 'A bakery site.', he: 'אתר למאפייה.' }] })
    const bad = { ...ok, structured_output: { projects: [{ id: 'a' }] } }
    expect(parseDescribeOutput(JSON.stringify(bad), '')).toMatchObject({ ok: false, costUsd: 0.025 })
    expect(parseDescribeOutput('', 'Invalid API key · Please run /login')).toMatchObject({ ok: false, code: 'auth' })
  })
})
