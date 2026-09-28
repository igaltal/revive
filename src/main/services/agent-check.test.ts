import { describe, expect, it } from 'vitest'
import type { Exec } from '../exec'
import { agentCheck } from './agent-check'
import { makeCore, platform, startTestHost } from '../contract/testing'
import { createHandlers } from '../contract/handlers'
import { WsTransport } from '@shared/ws-transport'

const fake =
  (answers: Record<string, { code: number; stdout?: string }>): Exec =>
  async (file, args) => {
    const a = answers[[file, ...args].join(' ')] ?? { code: 127 }
    return { code: a.code, stdout: a.stdout ?? '', stderr: '' }
  }

describe('can Claude Code or Codex start here?', () => {
  it('not installed, signed out, or ready', async () => {
    expect(await agentCheck(fake({}))('claude')).toEqual({ ok: false, problem: 'not_installed' })
    expect(await agentCheck(fake({ 'claude --version': { code: 0 }, 'claude auth status --json': { code: 1, stdout: '{"loggedIn":false}' } }))('claude')).toEqual({ ok: false, problem: 'signed_out' })
    expect(await agentCheck(fake({ 'claude --version': { code: 0 }, 'claude auth status --json': { code: 0, stdout: '{"loggedIn":true}' } }))('claude')).toEqual({ ok: true })
    expect(await agentCheck(fake({ 'codex --version': { code: 0 }, 'codex login status': { code: 1 } }))('codex')).toEqual({ ok: false, problem: 'signed_out' })
    expect(await agentCheck(fake({ 'codex --version': { code: 0 }, 'codex login status': { code: 0 } }))('codex')).toEqual({ ok: true })
  })

  it('a request from another device is checked on the Host, and nothing starts when it fails', async () => {
    const { core, folder } = makeCore({ agentCheck: async (kind) => (kind === 'codex' ? { ok: false, problem: 'not_installed' } : { ok: false, problem: 'signed_out' }) })
    await createHandlers(core, platform)['folder:choose']({ path: folder }, { transport: 'ipc', device: { id: 'local', name: 'x' } })
    await new Promise<void>((resolve) => {
      const off = core.streams.subscribe((s) => s === 'scan:done' && (off(), resolve()))
      void core.scans.start(folder, 'haiku')
    })
    const { server, token } = await startTestHost(core)
    const client = new WsTransport({ url: server.url, httpUrl: server.httpUrl, token })
    await client.connect()
    expect(await client.invoke('sessions:open', { projectId: 'bakery-site', kind: 'codex' })).toEqual({ ok: false, kind: 'codex', problem: 'not_installed' })
    expect(await client.invoke('sessions:open', { projectId: 'bakery-site', kind: 'claude' })).toEqual({ ok: false, kind: 'claude', problem: 'signed_out' })
    expect(core.hub.list()).toEqual([])
    // A plain shell needs no agent.
    expect(await client.invoke('sessions:open', { projectId: 'bakery-site', kind: 'shell' })).toMatchObject({ ok: true, created: true })
    await core.hub.killAll()
    client.close()
    await server.close()
  })
})
