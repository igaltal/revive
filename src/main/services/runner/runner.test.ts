import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Project } from '@shared/manifest'
import type { RunStatus, RuntimeEvent } from '@shared/runtime'
import { MASK } from '@shared/redact'
import { sampleManifest } from '@shared/test-fixtures'
import { RuntimeBus } from '../runtime-bus'
import { SessionHub } from '../sessions/session-hub'
import { childBackend } from '../sessions/child-backend'
import { listeningAnywhere } from './port-detect'
import { Runner, type RunRecord } from './runner'

const NODE = JSON.stringify(process.execPath)

/** A dev server that prints its address the way Vite does. */
const DEV_SERVER = `
const http = require('http')
const port = Number(process.argv[2] || 0)
const quiet = process.argv[3] === 'quiet'
const s = http.createServer((q, r) => r.end('<h1>hello</h1>'))
s.on('error', (e) => { console.error('Error: listen ' + e.code + ': address already in use :::' + port); process.exit(1) })
s.listen(port, '127.0.0.1', () => { if (!quiet) console.log('  ➜  Local:   http://localhost:' + s.address().port + '/') })
if (process.env.API_TOKEN) console.log('token is ' + process.env.API_TOKEN)
`

function project(patch: Partial<Project['run']> = {}, extra: Partial<Project> = {}): Project {
  const p = structuredClone(sampleManifest().projects[0]!)
  return { ...p, id: 'app', path: 'app', run: { ...p.run, ...patch }, ...extra }
}

function setup(p: Project, files: Record<string, string> = {}, timing = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'revive-run-')))
  writeFileSync(join(dir, 'dev.cjs'), DEV_SERVER)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  const bus = new RuntimeBus()
  const events: RuntimeEvent[] = []
  bus.subscribe((e) => events.push(e))
  const records: RunRecord[] = []
  const shots: string[] = []
  const runner = new Runner({
    hub: new SessionHub(childBackend, bus),
    bus,
    projects: { resolve: async () => ({ dir, project: p }), record: async (_id, r) => void records.push(r) },
    staticServer: { file: process.execPath, args: [resolve('src/main/services/runner/static-server.ts')], env: {} },
    capture: async (id) => {
      shots.push(id)
      return `/shots/${id}.png?v=1`
    },
    timing: { probeAfterMs: 200, probeEveryMs: 100, ...timing }
  })
  runners.push(runner)
  const statuses = () => events.filter((e) => e.type === 'status.changed').map((e) => (e as Extract<RuntimeEvent, { type: 'status.changed' }>).state.status)
  const until = async (status: RunStatus, ms = 15_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (runner.get('app')?.status === status) return runner.get('app')!
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error(`never reached ${status}; saw ${statuses().join(' → ')}\n${runner.logs('app').join('\n')}`)
  }
  return { dir, bus, events, records, shots, runner, statuses, until }
}

const runners: Runner[] = []
afterEach(async () => {
  await Promise.all(runners.splice(0).map((r) => r.stopAll()))
})

async function freePort(): Promise<number> {
  const s = createServer().listen(0, '127.0.0.1')
  await new Promise((r) => s.once('listening', r))
  const port = (s.address() as { port: number }).port
  await new Promise((r) => s.close(r))
  return port
}

describe('runner', () => {
  it('starts, finds the port, checks it answers, records it, takes a picture, and stops everything', async () => {
    const t = setup(project({ dev: `${NODE} dev.cjs` }))
    await t.runner.start('app')
    const running = await t.until('running')
    expect(running.url).toMatch(/^http:\/\/localhost:\d+\/$/)
    expect(t.statuses()).toEqual(['starting', 'starting', 'checking', 'running'])
    expect(t.events.map((e) => e.type)).toEqual(expect.arrayContaining(['process.started', 'process.output', 'port.detected', 'status.changed', 'manifest.changed']))
    expect(t.records[0]).toMatchObject({ status: 'verified', port: running.port, url: running.url })
    expect(t.records[0]!.verifiedAt).toBeTruthy()
    await new Promise((r) => setTimeout(r, 50))
    expect(t.shots).toEqual(['app'])
    expect(t.events.some((e) => e.type === 'shot.captured')).toBe(true)
    // Every event names the session by identity, never by process.
    const started = t.events.find((e) => e.type === 'process.started')!
    expect(started).toMatchObject({ session: { projectId: 'app', agent: 'shell' }, step: 'dev' })
    expect(JSON.stringify(started)).not.toMatch(/"pid"/)

    await t.runner.stop('app')
    expect(t.runner.get('app')!.status).toBe('stopped')
    expect(await listeningAnywhere(running.port!)).toBe(false)
    expect(t.events.some((e) => e.type === 'process.exited')).toBe(true)
  })

  it('gets things ready first when the parts are missing', async () => {
    const t = setup(project({ install: 'mkdir node_modules && echo installed', dev: `${NODE} dev.cjs` }), { 'package.json': '{}' })
    await t.runner.start('app')
    await t.until('running')
    expect(t.statuses()[0]).toBe('installing')
    expect(existsSync(join(t.dir, 'node_modules'))).toBe(true)
    expect(t.runner.logs('app')).toContain('installed')
  })

  it("doesn't install again when the parts are there", async () => {
    const t = setup(project({ install: 'echo SHOULD-NOT-RUN', dev: `${NODE} dev.cjs` }), { 'package.json': '{}' })
    mkdirSync(join(t.dir, 'node_modules'))
    await t.runner.start('app')
    await t.until('running')
    expect(t.statuses()).not.toContain('installing')
    expect(t.runner.logs('app').join('\n')).not.toContain('SHOULD-NOT-RUN')
  })

  it('masks values from the project .env in everything it reports', async () => {
    const t = setup(project({ dev: `API_TOKEN=plain-secret-9f8e7d ${NODE} dev.cjs` }), { '.env': 'API_TOKEN=plain-secret-9f8e7d\n' })
    await t.runner.start('app')
    await t.until('running')
    await new Promise((r) => setTimeout(r, 300))
    const everything = JSON.stringify(t.events) + t.runner.logs('app').join('\n')
    expect(everything).toContain(`token is ${MASK}`)
    expect(everything).not.toContain('plain-secret-9f8e7d')
  })

  it('explains a busy port in one known cause and records the project as broken', async () => {
    const port = await freePort()
    const blocker = createServer().listen(port, '127.0.0.1')
    await new Promise((r) => blocker.once('listening', r))
    try {
      const t = setup(project({ dev: `${NODE} dev.cjs ${port}` }))
      await t.runner.start('app')
      const broken = await t.until('broken')
      expect(broken.reason).toEqual({ code: 'port_busy' })
      expect(t.records.at(-1)).toEqual({ status: 'broken' })
    } finally {
      blocker.close()
    }
  })

  it("says so when it doesn't know how to start a project", async () => {
    const t = setup(project({ dev: null }))
    const state = await t.runner.start('app')
    expect(state).toMatchObject({ status: 'broken', reason: { code: 'no_start_command' } })
  })

  it('serves a plain page with its own file server', async () => {
    const t = setup(project({ dev: null }), { 'index.html': '<h1>Bakery</h1>' })
    await t.runner.start('app')
    const running = await t.until('running')
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    expect(await (await fetch(running.url!)).text()).toBe('<h1>Bakery</h1>')
    expect(t.events.find((e) => e.type === 'process.started')).toMatchObject({ step: 'serve' })
  })

  it('finds a port the output never mentions', async () => {
    const port = await freePort()
    const t = setup(project({ dev: `${NODE} dev.cjs ${port} quiet`, port }))
    await t.runner.start('app')
    const running = await t.until('running')
    expect(running.port).toBe(port)
    expect(t.events.find((e) => e.type === 'port.detected')).toMatchObject({ port, source: 'probe' })
  })

  it('gives up when nothing answers in time', async () => {
    const t = setup(project({ dev: `${NODE} -e "setInterval(() => {}, 1000)"` }), {}, { startTimeoutMs: 1500 })
    await t.runner.start('app')
    expect((await t.until('broken', 5000)).reason).toEqual({ code: 'timeout' })
  })

  it('notices when a running project stops on its own', async () => {
    const t = setup(project({ dev: `${NODE} -e "const s=require('http').createServer((q,r)=>r.end('x')).listen(0,'127.0.0.1',()=>{console.log('http://localhost:'+s.address().port+'/');setTimeout(()=>process.exit(3),800)})"` }))
    await t.runner.start('app')
    await t.until('running')
    expect((await t.until('stopped')).reason).toEqual({ code: 'exited' })
  })

  it('stops every project it started', async () => {
    const t = setup(project({ dev: `${NODE} dev.cjs` }))
    await t.runner.start('app')
    const { port } = await t.until('running')
    await t.runner.stopAll()
    expect(t.runner.list().map((r) => r.status)).toEqual(['stopped'])
    expect(await listeningAnywhere(port!)).toBe(false)
  })
})
