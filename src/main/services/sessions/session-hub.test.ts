import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@shared/runtime'
import { MASK } from '@shared/redact'
import { RuntimeBus } from '../runtime-bus'
import type { SessionBackend, SessionExit, SessionHandle } from './backend'
import { SessionHub } from './session-hub'

/** A backend whose output the test writes by hand. */
function manualBackend() {
  let push: (d: string) => void = () => {}
  let exit: (e: SessionExit) => void = () => {}
  const backend: SessionBackend = {
    kind: 'pty',
    persistent: false,
    list: async () => [],
    attach: () => {
      throw new Error('no')
    },
    end: async () => {},
    spawn(spec): SessionHandle {
      return {
        ref: spec.ref,
        write: () => {},
        resize: () => {},
        onData: (l) => ((push = l), () => {}),
        onExit: (l) => ((exit = l), () => {}),
        detach: async () => {},
        kill: async () => {
          const e = { exitCode: null, signal: 'SIGTERM' }
          exit(e)
          return e
        }
      }
    }
  }
  return { backend, push: (d: string) => push(d), exit: (e: SessionExit) => exit(e) }
}

const spec = { ref: { projectId: 'p', kind: 'run' as const }, cwd: '/', file: 'x', args: [], env: {}, step: 'dev' as const, display: 'npm run dev', secrets: ['hunter2-secret'] }

describe('session hub', () => {
  it('masks a secret even when it arrives split across two chunks', async () => {
    const m = manualBackend()
    const bus = new RuntimeBus()
    const out: string[] = []
    bus.subscribe((e) => e.type === 'process.output' && out.push(e.data))
    new SessionHub(m.backend, bus).start(spec)
    m.push('value: hunter2-')
    m.push('secret done\n')
    expect(out).toEqual(['$ npm run dev\r\n', `value: ${MASK} done\n`])
  })

  it('flushes a line without a newline after a short pause (prompts)', async () => {
    const m = manualBackend()
    const bus = new RuntimeBus()
    const out: string[] = []
    bus.subscribe((e) => e.type === 'process.output' && out.push(e.data))
    new SessionHub(m.backend, bus).start(spec)
    m.push('Ok to proceed? (y) ')
    await new Promise((r) => setTimeout(r, 250))
    expect(out.at(-1)).toBe('Ok to proceed? (y) ')
  })

  it('names sessions by project and kind, allows one at a time, and reports the exit', async () => {
    const m = manualBackend()
    const bus = new RuntimeBus()
    const events: RuntimeEvent[] = []
    bus.subscribe((e) => events.push(e))
    const hub = new SessionHub(m.backend, bus)
    const { exited } = hub.start(spec)
    expect(() => hub.start(spec)).toThrow(/already running/)
    expect(hub.list()).toEqual([{ ref: spec.ref, step: 'dev' }])
    m.push('\u001b[32mready\u001b[0m\n⠙⠹⠸\r⠇\n⠇found 0 vulnerabilities\n')
    m.exit({ exitCode: 0, signal: null })
    await exited
    expect(hub.list()).toEqual([])
    expect(events.map((e) => e.type)).toEqual(['process.started', 'process.output', 'process.output', 'process.exited'])
    expect(hub.log(spec.ref)).toEqual(['$ npm run dev', 'ready', 'found 0 vulnerabilities'])
  })
})

describe('session output', () => {
  it('lives in the session buffer with offsets, and a late client can fetch it', () => {
    const m = manualBackend()
    const bus = new RuntimeBus()
    const offsets: number[] = []
    bus.subscribe((e) => e.type === 'process.output' && offsets.push(e.offset))
    const hub = new SessionHub(m.backend, bus)
    hub.start(spec)
    m.push('one\n')
    m.push('two\n')
    const all = hub.output('p:run', 0)
    expect(all).toEqual({ sessionId: 'p:run', epoch: expect.stringMatching(/^[0-9a-f]{12}$/), data: '$ npm run dev\r\none\ntwo\n', fromOffset: 0, nextOffset: 23, truncated: false })
    // An offset from another lifetime (before a restart) starts over from this one, marked.
    expect(hub.output('p:run', 19, 'old-epoch')).toMatchObject({ fromOffset: 0, truncated: true, data: '$ npm run dev\r\none\ntwo\n' })
    expect(offsets).toEqual([0, 15, 19])
    expect(hub.output('p:run', 19).data).toBe('two\n')
    expect(hub.output('p:shell', 0)).toMatchObject({ data: '', nextOffset: 0 })
  })
})

describe('output buffer', () => {
  it('keeps the last bytes, and offsets never go back', async () => {
    const { OutputBuffer } = await import('./output-buffer')
    const b = new OutputBuffer(10)
    expect(b.append('aaaa')).toBe(0)
    expect(b.append('bbbb')).toBe(4)
    expect(b.append('cccc')).toBe(8)
    expect(b.startOffset).toBe(4)
    expect(b.read(0)).toEqual({ data: 'bbbbcccc', fromOffset: 4, nextOffset: 12, truncated: true })
    expect(b.read(6)).toEqual({ data: 'bbcccc', fromOffset: 6, nextOffset: 12, truncated: false })
    expect(b.read(12)).toEqual({ data: '', fromOffset: 12, nextOffset: 12, truncated: false })
  })

  it('counts bytes, not characters, and never splits a character', async () => {
    const { OutputBuffer } = await import('./output-buffer')
    const b = new OutputBuffer(1024)
    b.append('שלום\n')
    expect(b.endOffset).toBe(9)
    expect(b.read(0).data).toBe('שלום\n')
  })
})

describe('runtime bus', () => {
  it('numbers state events and replays what a late client missed; output is never replayed', () => {
    const bus = new RuntimeBus(3)
    for (let i = 0; i < 5; i++) {
      bus.emit({ type: 'manifest.changed' })
      bus.emitOutput({ session: { projectId: 'p', kind: 'run' }, data: 'x', offset: i, epoch: 'e1' })
    }
    expect(bus.since(0).map((e) => e.seq)).toEqual([3, 4, 5])
    expect(bus.since(4).map((e) => e.seq)).toEqual([5])
    expect(bus.since(0).some((e) => (e.type as string) === 'process.output')).toBe(false)
  })

  it('session ids are project + kind and parse back', async () => {
    const { parseSessionId, sessionId } = await import('@shared/runtime')
    expect(sessionId({ projectId: 'my-app', kind: 'run' })).toBe('my-app:run')
    expect(parseSessionId('my:app:claude')).toEqual({ projectId: 'my:app', kind: 'claude' })
    expect(parseSessionId('my-app:bash')).toBeNull()
  })
})
