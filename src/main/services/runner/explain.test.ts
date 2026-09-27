import { describe, expect, it } from 'vitest'
import { ruleExplainer } from './explain'

const explain = (log: string[], extra: Partial<Parameters<typeof ruleExplainer.explain>[0]> = {}) =>
  ruleExplainer.explain({ log, step: 'dev', timedOut: false, keys: ['GOOGLE_MAPS_API_KEY'], tools: ['npm'], ...extra })

describe('why a start failed, in one known cause', () => {
  it('port busy', () => {
    expect(explain(['Error: listen EADDRINUSE: address already in use :::3000'])).toEqual({ code: 'port_busy' })
    expect(explain(['OSError: [Errno 48] Address already in use'])).toEqual({ code: 'port_busy' })
  })
  it('a tool that is not installed', () => {
    expect(explain(['zsh:1: command not found: npm'])).toEqual({ code: 'tool_missing', tool: 'npm' })
    expect(explain(['/bin/sh: python3: command not found'], { tools: ['python3'] })).toEqual({ code: 'tool_missing', tool: 'python3' })
  })
  it('parts not downloaded yet', () => {
    expect(explain(['sh: vite: command not found'])).toEqual({ code: 'deps_missing' })
    expect(explain(["Error: Cannot find module 'express'"])).toEqual({ code: 'deps_missing' })
    expect(explain(["ModuleNotFoundError: No module named 'flask'"])).toEqual({ code: 'deps_missing' })
  })
  it('a missing key, named by the manifest', () => {
    expect(explain(['Error: GOOGLE_MAPS_API_KEY is not defined'])).toEqual({ code: 'missing_key', key: 'GOOGLE_MAPS_API_KEY' })
  })
  it('install failures, time-outs and the rest', () => {
    expect(explain(['npm ERR! code E404'], { step: 'install' })).toEqual({ code: 'install_failed' })
    expect(explain(['compiling…'], { timedOut: true })).toEqual({ code: 'timeout' })
    expect(explain(['TypeError: x is not a function'])).toEqual({ code: 'unknown' })
  })
})
