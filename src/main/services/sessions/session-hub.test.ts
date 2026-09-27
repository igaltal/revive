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
    spawn(spec): SessionHandle {
      return {
        ref: spec.ref,
        write: () => {},
        resize: () => {},
        onData: (l) => ((push = l), () => {}),
        onExit: (l) => ((exit = l), () => {}),
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

const spec = { ref: { projectId: 'p', agent: 'shell' as const }, cwd: '/', file: 'x', args: [], env: {}, step: 'dev' as const, display: 'npm run dev', secrets: ['hunter2-secret'] }

describe('session hub', () => {
  it('masks a secret even when it arrives split across two chunks', async () => {
    const m = manualBackend()
    const bus = new RuntimeBus()
    const out: string[] = []
    bus.subscribe((e) => e.type === 'process.output' && out.push(e.data))
    new SessionHub(m.backend, bus).start(spec)
    m.push('value: hunter2-')
    m.push('secret done\n')
    expect(out).toEqual([`value: ${MASK} done\n`])
  })

  it('flushes a line without a newline after a short pause (prompts)', async () => {
    const m = manualBackend()
    const bus = new RuntimeBus()
    const out: string[] = []
    bus.subscribe((e) => e.type === 'process.output' && out.push(e.data))
    new SessionHub(m.backend, bus).start(spec)
    m.push('Ok to proceed? (y) ')
    await new Promise((r) => setTimeout(r, 250))
    expect(out).toEqual(['Ok to proceed? (y) '])
  })

  it('names sessions by project and agent, allows one at a time, and reports the exit', async () => {
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
    expect(events.map((e) => e.type)).toEqual(['process.started', 'process.output', 'process.exited'])
    expect(hub.log(spec.ref)).toEqual(['$ npm run dev', 'ready', 'found 0 vulnerabilities'])
  })
})

describe('runtime bus', () => {
  it('numbers events and replays what a late client missed', () => {
    const bus = new RuntimeBus(3)
    for (let i = 0; i < 5; i++) bus.emit({ type: 'manifest.changed' })
    expect(bus.since(0).map((e) => e.seq)).toEqual([3, 4, 5])
    expect(bus.since(4).map((e) => e.seq)).toEqual([5])
  })
})
