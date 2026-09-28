import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import type { SessionChunk } from '@shared/contract'
import type { StateEvent } from '@shared/runtime'
import { WsTransport } from '@shared/ws-transport'
import { stripAnsi } from '@shared/ansi'
import { RuntimeBus } from '../runtime-bus'
import { SessionHub } from './session-hub'
import { Sessions } from './sessions'
import { findTmux, TmuxBackend } from './tmux-backend'
import { tmuxName } from './tmux-names'
import { cleanEnv } from '../terminals'
import { makeCore, startTestHost, until } from '../../contract/testing'
import type { SessionHandle } from './backend'

const TMUX = findTmux()!
const backends: TmuxBackend[] = []
afterAll(() => {
  for (const b of backends) b.killServer()
})

/** A backend on its own throwaway socket, so the real `revive` socket is never touched. */
function backend(home = mkdtempSync(join(tmpdir(), 'revive-home-'))): TmuxBackend {
  const b = new TmuxBackend({
    tmux: TMUX,
    socket: `revive-test-${randomBytes(4).toString('hex')}`,
    config: resolve('resources/tmux.conf'),
    exitDir: mkdtempSync(join(tmpdir(), 'revive-exit-')),
    env: { ...cleanEnv(), HOME: home, XDG_CONFIG_HOME: join(home, '.config') }
  })
  backends.push(b)
  return b
}

/** Prints "tick N" every 50 ms, forever, and writes the time of each tick to a file. */
function standInAgent(): { file: string; ticks: string } {
  const dir = mkdtempSync(join(tmpdir(), 'revive-agent-'))
  const ticks = join(dir, 'ticks.log')
  const file = join(dir, 'agent.cjs')
  writeFileSync(file, `const fs=require('fs');let n=0;setInterval(()=>{n++;console.log('tick '+n);fs.appendFileSync(${JSON.stringify(ticks)}, n+' '+Date.now()+'\\n')},50)`)
  return { file, ticks }
}

const collect = (h: SessionHandle) => {
  const out = { text: '' }
  h.onData((d) => (out.text += d))
  return out
}
const spec = (b: TmuxBackend, projectId: string, kind: 'shell' | 'claude' | 'run', file: string, args: string[]) => ({
  ref: { projectId, kind },
  cwd: tmpdir(),
  file,
  args,
  env: cleanEnv(),
  cols: 100,
  rows: 30,
  step: kind === 'run' ? ('dev' as const) : ('terminal' as const),
  display: [file, ...args].join(' ')
})

describe('tmux backend', () => {
  it("ignores the user's ~/.tmux.conf, however hostile", async () => {
    const home = mkdtempSync(join(tmpdir(), 'revive-home-'))
    const hostile = 'set -g prefix C-a\nset -g status on\nset -g history-limit 10\nbind-key -n x send-keys y\nset -g default-terminal screen\n'
    writeFileSync(join(home, '.tmux.conf'), hostile)
    mkdirSync(join(home, '.config/tmux'), { recursive: true })
    writeFileSync(join(home, '.config/tmux/tmux.conf'), hostile)
    const b = backend(home)
    const h = b.spawn(spec(b, 'cat', 'shell', '/bin/cat', []))
    const out = collect(h)
    // "x" would become "y" under the hostile root binding.
    h.write('xax\r')
    await until('echo from cat', () => out.text.includes('xax'))
    expect(out.text).not.toContain('yay')
    const show = (o: string) => b.runSync(['show-options', '-gv', o]).stdout.trim()
    expect(show('status')).toBe('off')
    expect(show('prefix')).toBe('None')
    expect(show('history-limit')).toBe('50000')
    expect(b.runSync(['show-options', '-sv', 'default-terminal']).stdout.trim()).toBe('xterm-256color')
    expect(b.runSync(['list-keys']).stdout.trim()).toBe('')
    await h.kill()
  })

  it('reports the real exit status of the command', async () => {
    const b = backend()
    const h = b.spawn(spec(b, 'fails', 'run', '/bin/sh', ['-c', 'echo about to fail; exit 3']))
    const exit = await new Promise((r) => h.onExit(r))
    expect(exit).toEqual({ exitCode: 3, signal: null })
    expect(b.exists(tmuxName({ projectId: 'fails', kind: 'run' }))).toBe(false)
  })

  it('a session outlives its viewer; a new Revive finds it by name (Hebrew id included) and shows its history first', async () => {
    const b = backend()
    const agent = standInAgent()
    const projectId = 'סוכן של נועה'
    const h = b.spawn(spec(b, projectId, 'claude', process.execPath === 'node' ? 'node' : 'node', [agent.file]))
    const first = collect(h)
    await until('tick 5', () => first.text.includes('tick 5'))
    await h.detach()
    const name = tmuxName({ projectId, kind: 'claude' })
    expect(name).toMatch(/^revive-h[0-9a-f]{10}-claude$/)
    expect(b.exists(name)).toBe(true)
    const before = readFileSync(agent.ticks, 'utf8').split('\n').length
    await new Promise((r) => setTimeout(r, 400))
    expect(readFileSync(agent.ticks, 'utf8').split('\n').length).toBeGreaterThan(before + 3) // still running

    // A new Revive: fresh backend object on the same socket, no memory of the name.
    const again = new TmuxBackend({ tmux: TMUX, socket: (b as unknown as { opts: { socket: string } }).opts.socket, config: resolve('resources/tmux.conf'), exitDir: mkdtempSync(join(tmpdir(), 'x-')), env: cleanEnv() })
    const found = (await again.list()).find((e) => e.name === name)
    expect(found).toMatchObject({ ref: { projectId, kind: 'claude' }, step: 'terminal' })
    const h2 = again.attach({ ...found!, ref: found!.ref! })
    const second = collect(h2)
    await until('history then live', () => second.text.includes('tick 1\r\n') && /tick (\d+)/.test(second.text.slice(-200)))
    expect(second.text.indexOf('tick 1\r\n')).toBeLessThan(second.text.indexOf('tick 5'))
    await h2.kill()
    expect(again.exists(name)).toBe(false)
  })
})

describe('sessions left running', () => {
  it('adopts the ones of known projects; lists the others and never ends them silently', async () => {
    const b = backend()
    const bus = new RuntimeBus()
    const hub = new SessionHub(b, bus)
    const agent = standInAgent()
    const mine = b.spawn(spec(b, 'bakery-site', 'claude', 'node', [agent.file]))
    const gone = b.spawn(spec(b, 'project-that-is-gone', 'shell', '/bin/cat', []))
    await Promise.all([mine.detach(), gone.detach()])

    const adopted: string[] = []
    const sessions = new Sessions({
      hub,
      backend: b,
      projects: {
        resolve: async () => ({ dir: tmpdir(), project: {} as never }),
        record: async () => {},
        projectIds: async () => ({ projectIds: new Set(['bakery-site']) })
      },
      runner: { adopt: async (id) => void adopted.push(id), stopAll: async () => {} },
      tmuxVersion: '3.7c'
    })
    await sessions.adopt()
    expect(hub.list().map((s) => s.ref)).toEqual([{ projectId: 'bakery-site', kind: 'claude' }])
    const info = sessions.info()
    expect(info).toMatchObject({ backend: 'tmux', persistent: true, orphans: [{ name: 'revive-project-that-is-gone-shell', projectId: 'project-that-is-gone', kind: 'shell' }] })
    // Listed, not ended.
    expect(b.exists('revive-project-that-is-gone-shell')).toBe(true)
    // Its buffer was rebuilt from tmux's history.
    await until('history in the buffer', () => hub.output('bakery-site:claude', 0).data.includes('tick 1'))

    await sessions.endOrphan('revive-project-that-is-gone-shell')
    expect(b.exists('revive-project-that-is-gone-shell')).toBe(false)
    expect(sessions.info().orphans).toEqual([])

    // Quitting in local mode with "keep agents running": the agent survives.
    await sessions.quit({ hosting: false, keepAgents: true })
    expect(b.exists(tmuxName({ projectId: 'bakery-site', kind: 'claude' }))).toBe(true)
  })
})

describe('the runner and Host clients on tmux', () => {
  it('finds the port and checks the page through tmux; two clients with different sizes; a drop mid-output loses nothing and never pauses the agent', async () => {
    const b = backend()
    const { core } = makeCore({ backend: b })
    const { server, token } = await startTestHost(core)
    const created = (await core.workspace.choose(mkdtempSync(join(tmpdir(), 'revive-empty-')))).ok
    expect(created).toBe(true)

    // Runner through tmux: the dev server's address comes out of tmux's screen output.
    const hub = core.hub
    const { handle, exited } = hub.start({ ...spec(b, 'noisy', 'run', 'node', ['-e', "const s=require('http').createServer((q,r)=>r.end('ok')).listen(0,'127.0.0.1',()=>console.log('  ➜  Local:   http://localhost:'+s.address().port+'/'))"]), secrets: [] })
    const seen = collect(handle)
    await until('address through tmux', () => /Local:\s+http:\/\/localhost:\d+\//.test(stripAnsi(seen.text)))
    await handle.kill()
    await exited

    // An agent in a terminal, watched by two clients.
    const agent = standInAgent()
    const { handle: h } = hub.start({ ...spec(b, 'agent', 'claude', 'node', [agent.file]), secrets: [] })
    const name = tmuxName({ projectId: 'agent', kind: 'claude' })
    const a = new WsTransport({ url: server.url, httpUrl: server.httpUrl, token, retry: { minMs: 20, maxMs: 100 } })
    const c = new WsTransport({ url: server.url, httpUrl: server.httpUrl, token, retry: { minMs: 20, maxMs: 100 } })
    await Promise.all([a.connect(), c.connect()])
    const got: Record<string, SessionChunk[]> = { a: [], c: [] }
    a.subscribe('session:output', (ch) => got['a']!.push(ch), { sessionId: 'agent:claude', fromOffset: 0 })
    c.subscribe('session:output', (ch) => got['c']!.push(ch), { sessionId: 'agent:claude', fromOffset: 0 })
    const text = (k: string) => got[k]!.map((x) => x.data).join('')
    await until('both see ticks', () => text('a').includes('tick 3') && text('c').includes('tick 3'))

    // Different window sizes: the latest one wins (tmux window-size latest).
    const size = () => b.runSync(['display-message', '-p', '-t', `=${name}:`, '#{window_width}x#{window_height}']).stdout.trim()
    a.resizeSession('agent:claude', 100, 30)
    await until('100x30', () => size() === '100x30')
    c.resizeSession('agent:claude', 60, 20)
    await until('60x20', () => size() === '60x20')
    a.resizeSession('agent:claude', 120, 40)
    await until('120x40', () => size() === '120x40')

    // A drop in the middle of output: the agent never pauses, and the client gets everything it missed.
    const lastSeen = () => Math.max(...[...text('a').matchAll(/tick (\d+)/g)].map((m) => Number(m[1])))
    const beforeDrop = lastSeen()
    const dropUntil = Date.now() + 1500
    while (Date.now() < dropUntil) {
      server.dropAll()
      await new Promise((r) => setTimeout(r, 100))
    }
    const target = lastSeen() + 20
    await until('caught up after the drop', () => lastSeen() >= target, 10_000)
    // tmux output is screen rendering (a resize redraws the screen), so lines can legitimately
    // come round again. What must hold: every byte arrives once, in order, with no gaps...
    let end = got['a']![0]!.offset
    for (const ch of got['a']!) {
      expect(ch.truncated ?? false).toBe(false)
      expect(ch.offset).toBe(end)
      end = ch.offset + Buffer.byteLength(ch.data)
    }
    // ...and every tick the agent printed while the client was away reached it.
    const received = new Set([...text('a').matchAll(/tick (\d+)/g)].map((m) => Number(m[1])))
    for (let n = beforeDrop; n <= target; n++) expect(received.has(n), `tick ${n}`).toBe(true)
    // The agent's own clock: no pause while the client was away.
    const times = readFileSync(agent.ticks, 'utf8').trim().split('\n').map((l) => Number(l.split(' ')[1]))
    const gaps = times.slice(1).map((t, i) => t - times[i]!)
    expect(Math.max(...gaps)).toBeLessThan(500)

    a.close()
    c.close()
    await h.kill()
    await server.close()
    const events: StateEvent[] = core.bus.since(0)
    expect(events.some((e) => e.type === 'process.started' && e.backend === 'tmux')).toBe(true)
  }, 60_000)
})
