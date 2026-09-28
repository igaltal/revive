import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SessionChunk } from '@shared/contract'
import { SERVER_STREAMS } from '@shared/contract-names'
import type { StateEvent } from '@shared/runtime'
import type { DesktopBridge, Transport } from '@shared/transport'
import { WsTransport } from '@shared/ws-transport'
import { IpcTransport } from '../../renderer/transport/ipc-transport'
import { createHandlers, type Core } from './handlers'
import { makeCore, platform, startTestHost, until } from './testing'
import { registerIpc } from './ipc'
import { hubSink, noAppHandlers } from './dispatch'
import type { HostServer } from './host-server'

interface Harness {
  client: Transport & { resume(): Promise<void> }
  /** Loses messages (a dropped connection, a reloading window) until `restore`. */
  drop(): void
  restore(): Promise<void>
  close(): Promise<void>
}

/** IPC through the generated registration, with Electron's ipcMain and the preload bridge stood in. */
async function ipcHarness(core: Core): Promise<Harness> {
  const handles = new Map<string, (e: unknown, raw: unknown) => Promise<unknown>>()
  const ons = new Map<string, (e: unknown, raw: unknown) => void>()
  const listeners = new Map<string, Set<(p: unknown) => void>>()
  let dropped = false
  registerIpc({
    ipcMain: { handle: ((n: string, fn: never) => handles.set(n, fn)) as never, on: ((n: string, fn: never) => ons.set(n, fn)) as never },
    handlers: { ...createHandlers(core, platform), ...noAppHandlers() },
    streams: core.streams,
    sessions: hubSink(core.hub),
    target: () => ({
      isDestroyed: () => false,
      // Electron serializes IPC with structured clone.
      send: (stream: string, payload: unknown) => {
        if (!dropped) for (const l of listeners.get(stream) ?? []) l(structuredClone(payload))
      }
    }),
    checkOutputs: true
  })
  const bridge: DesktopBridge = {
    invoke: async (m, i) => {
      const h = handles.get(m)
      if (!h) throw new Error(`Unknown method: ${m}`)
      return structuredClone(await h({}, structuredClone(i)))
    },
    on: (s, l) => {
      if (!(SERVER_STREAMS as readonly string[]).includes(s)) throw new Error(`Unknown stream: ${s}`)
      if (!listeners.has(s)) listeners.set(s, new Set())
      listeners.get(s)!.add(l)
      return () => listeners.get(s)!.delete(l)
    },
    send: (s, p) => ons.get(s)?.({}, structuredClone(p)),
    pathForFile: () => ''
  }
  const client = new IpcTransport(bridge)
  return {
    client,
    drop: () => (dropped = true),
    restore: async () => {
      dropped = false
      await client.resume()
    },
    close: async () => {}
  }
}

/** A real WebSocket server in process, and the real WsTransport. */
async function wsHarness(core: Core): Promise<Harness & { server: HostServer }> {
  const { server, token } = await startTestHost(core)
  const client = new WsTransport({ url: server.url, httpUrl: server.httpUrl, token, retry: { minMs: 20, maxMs: 100 } })
  await client.connect()
  let state = 'open'
  client.onConnection((st) => (state = st))
  let dropping = false
  let loop: Promise<void> = Promise.resolve()
  return {
    server,
    client,
    // Keeps cutting the connection (the client keeps reconnecting and resuming) until restored.
    drop: () => {
      dropping = true
      loop = (async () => {
        while (dropping) {
          server.dropAll()
          await new Promise((r) => setTimeout(r, 30))
        }
      })()
    },
    restore: async () => {
      dropping = false
      await loop
      await until('reconnected', () => state === 'open')
    },
    close: async () => {
      client.close()
      await server.close()
    }
  }
}

describe.each([
  ['IPC', ipcHarness],
  ['WebSocket', wsHarness]
] as const)('the contract over %s', (_name, make) => {
  let core: Core
  let folder: string
  let h: Harness
  const events: StateEvent[] = []

  beforeAll(async () => {
    ;({ core, folder } = makeCore())
    h = await make(core)
    h.client.subscribe('runtime:event', (e) => events.push(e))
  })
  afterAll(async () => {
    await core.runner.stopAll()
    await h.close()
  })

  const statuses = (projectId: string, from: StateEvent[]) =>
    from.flatMap((e) => (e.type === 'status.changed' && e.state.projectId === projectId ? [e.state.status] : []))

  it('chooses a folder and reads it (a scan), with progress and the saved version on the stream', async () => {
    const settings: unknown[] = []
    h.client.subscribe('settings:changed', (s) => settings.push(s))
    expect(await h.client.invoke('folder:choose', { path: folder })).toMatchObject({ ok: true })
    await until('settings:changed', () => settings.length > 0)

    const progress: string[] = []
    let done: unknown = null
    h.client.subscribe('scan:progress', (p) => progress.push(p.phase))
    h.client.subscribe('scan:done', (d) => (done = d))
    const { scanId } = await h.client.invoke('scan:start')
    expect(scanId).toBeTruthy()
    await until('scan:done', () => done !== null)
    expect(done).toMatchObject({ ok: true, costParts: [{ step: 'index' }, { step: 'describe' }] })
    expect(progress).toEqual(expect.arrayContaining(['saving', 'reading', 'checking', 'done']))
    expect(events.some((e) => e.type === 'version.saved' && e.version.kind === 'scan')).toBe(true)
    const m = await h.client.invoke('manifest:get')
    expect(m.state === 'ok' && m.manifest.projects.map((p) => p.id)).toEqual(['bakery-site', 'habit-counter', 'noisy', 'flood', 'echo'])
  })

  it('starts and stops a run session, with its output on the session stream', async () => {
    const chunks: SessionChunk[] = []
    const off = h.client.subscribe('session:output', (c) => chunks.push(c), { sessionId: 'bakery-site:run', fromOffset: 0 })
    const started = await h.client.invoke('runner:start', { projectId: 'bakery-site' })
    expect(['starting', 'running', 'checking']).toContain(started.status)
    await until('running', () => statuses('bakery-site', events).includes('running'))
    await until('output', () => chunks.map((c) => c.data).join('').includes('Serving'))
    expect((await h.client.invoke('runner:list')).find((r) => r.projectId === 'bakery-site')?.status).toBe('running')
    expect(await h.client.invoke('runner:logs', { projectId: 'bakery-site' })).toContain('$ revive static-server .')

    await h.client.invoke('runner:stop', { projectId: 'bakery-site' })
    await until('stopped', () => statuses('bakery-site', events).includes('stopped'))
    expect(statuses('bakery-site', events)).toEqual(['starting', 'starting', 'checking', 'running', 'stopping', 'stopped'])
    expect(events.some((e) => e.type === 'process.exited' && e.session.projectId === 'bakery-site' && e.session.kind === 'run')).toBe(true)
    off()
  })

  it('sends keystrokes into a session', async () => {
    const chunks: string[] = []
    const off = h.client.subscribe('session:output', (c) => chunks.push(c.data), { sessionId: 'echo:run', fromOffset: 0 })
    await h.client.invoke('runner:start', { projectId: 'echo' })
    await until('echo started', () => events.some((e) => e.type === 'process.started' && e.session.projectId === 'echo'))
    h.client.writeSession('echo:run', 'hello\n')
    h.client.resizeSession('echo:run', 100, 30)
    await until('echo', () => chunks.join('').includes('got:hello'))
    await h.client.invoke('runner:stop', { projectId: 'echo' })
    off()
  })

  it("goes back to a saved version for one project, and says so on the stream", async () => {
    const v = await h.client.invoke('versions:save')
    const page = join(folder, 'bakery-site/index.html')
    const original = readFileSync(page, 'utf8')
    writeFileSync(page, '<h1>changed</h1>')
    expect(await h.client.invoke('versions:preview', { versionId: v.id, projectId: 'bakery-site' })).toMatchObject({ changedFiles: 1, projectId: 'bakery-site' })
    const r = await h.client.invoke('versions:restore', { versionId: v.id, projectId: 'bakery-site' })
    expect(r).toMatchObject({ ok: true, projectId: 'bakery-site', changedFiles: 1 })
    expect(readFileSync(page, 'utf8')).toBe(original)
    await until('version.restored', () => events.some((e) => e.type === 'version.restored' && e.versionId === v.id))
    expect((await h.client.invoke('versions:list'))[0]).toMatchObject({ kind: 'restore', scope: 'bakery-site' })
  })

  it('checks every input, whichever transport it came through', async () => {
    await expect(h.client.invoke('runner:start', { projectId: '' })).rejects.toMatchObject({ code: 'bad_input', message: expect.stringMatching(/projectId/) })
    await expect(h.client.invoke('runner:start', { projectId: 'no-such-project' })).rejects.toMatchObject({ code: 'failed' })
    await expect(h.client.invoke('trash:empty', { confirm: 'yes' } as never)).rejects.toThrow()
    await expect(h.client.invoke('sessions:output', { sessionId: 'x:bash', fromOffset: 0 })).rejects.toThrow(/unknown session/)
  })

  it('reconnects in the middle of a noisy dev server and still ends with every status change and the tail of the output', async () => {
    const chunks: SessionChunk[] = []
    const mine: StateEvent[] = []
    const offEv = h.client.subscribe('runtime:event', (e) => mine.push(e))
    const off = h.client.subscribe('session:output', (c) => chunks.push(c), { sessionId: 'noisy:run', fromOffset: 0 })
    await h.client.invoke('runner:start', { projectId: 'noisy' })
    await until('first output', () => chunks.reduce((n, c) => n + c.data.length, 0) > 20_000)

    // The connection goes away while the server keeps printing and reaches "running".
    h.drop()
    await until('running on the server', () => core.runner.get('noisy')?.status === 'running', 30_000)
    await h.restore()
    await until('running on the client', () => statuses('noisy', mine).includes('running'))
    await h.client.invoke('runner:stop', { projectId: 'noisy' })
    await until('stopped on the client', () => statuses('noisy', mine).includes('stopped'))

    // Every status change, in order, exactly as the server made them.
    const truth = statuses('noisy', core.bus.since(0))
    expect(statuses('noisy', mine)).toEqual(truth)
    expect(truth).toEqual(['starting', 'starting', 'checking', 'running', 'stopping', 'stopped'])

    // Output: no repeats, and any gap is marked; it ends exactly where the server's buffer ends.
    let end = chunks[0]!.offset
    for (const c of chunks) {
      if (!c.truncated) expect(c.offset).toBe(end)
      else expect(c.offset).toBeGreaterThanOrEqual(end)
      end = c.offset + Buffer.byteLength(c.data)
    }
    const server = core.hub.output('noisy:run', 0)
    expect(end).toBe(server.nextOffset)
    const text = chunks.map((c) => c.data).join('')
    expect(text).toMatch(/Local: http:\/\/localhost:\d+\/\r?\n/)
    expect(text).toContain('compiling module 20000 ')
    off()
    offEv()
  }, 60_000)
})
