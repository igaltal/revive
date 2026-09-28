import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HostStatus } from '@shared/host'
import type { Exec } from '../../exec'
import { createHandlers } from '../../contract/handlers'
import { ServerStreams } from '../../contract/streams'
import { withActionLog } from '../../contract/dispatch'
import { makeCore, platform } from '../../contract/testing'
import { ActionLog } from './action-log'
import { HostService, type HostPlatform } from './host-service'

const services: HostService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((h) => h.stop()))
})

/** A stand-in for the tailscale CLI and pmset, recording every command. */
function fakeSystem(opts: { tailscale: 'missing' | 'running'; servedPort?: () => number | null; sleep?: number }) {
  const calls: string[][] = []
  const exec: Exec = async (file, args) => {
    calls.push([file, ...args])
    if (file === '/usr/bin/pmset') return { code: 0, stdout: ` sleep                ${opts.sleep ?? 0} (sleep prevented by caffeinate)\n displaysleep         10\n`, stderr: '' }
    if (file === 'tailscale' || file.endsWith('/Tailscale')) {
      if (opts.tailscale === 'missing') return { code: 127, stdout: '', stderr: '' }
      if (args[0] === 'status') return { code: 0, stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'studio-mac.tail1234.ts.net.' } }), stderr: '' }
      if (args[0] === 'serve' && args[1] === 'status') {
        const p = opts.servedPort?.()
        return { code: 0, stdout: p ? JSON.stringify({ Web: { 'studio-mac.tail1234.ts.net:443': { Handlers: { '/': { Proxy: `http://127.0.0.1:${p}` } } } } }) : '{}', stderr: '' }
      }
      if (args[0] === 'serve' && args[1] === '--bg') return { code: 0, stdout: 'Available within your tailnet', stderr: '' }
    }
    return { code: 127, stdout: '', stderr: '' }
  }
  return { exec, calls }
}

function make(userData: string, exec: Exec, extra: Partial<HostPlatform> = {}) {
  const { core } = makeCore()
  const log = new ActionLog(join(userData, 'action-log.jsonl'))
  const awake: boolean[] = []
  const sharing: boolean[] = []
  let login = false
  const out = new ServerStreams()
  const seen: HostStatus[] = []
  out.subscribe((s, p) => s === 'host:status' && seen.push(p as HostStatus))
  const host = new HostService({
    userData,
    core,
    handlers: withActionLog(createHandlers(core, platform), log),
    out,
    log,
    checkOutputs: true,
    platform: {
      hostName: 'Studio Mac',
      exec,
      persistentSessions: true,
      keepAwake: (on) => awake.push(on),
      loginItem: { get: () => login, set: (on) => (login = on) },
      sharingChanged: (on) => sharing.push(on),
      ...extra
    }
  })
  services.push(host)
  return { host, awake, sharing, seen }
}

describe('Host mode', () => {
  it('sharing starts the server on 127.0.0.1, keeps the Mac awake, and comes back on its own port after a restart', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'revive-hostsvc-'))
    const sys = fakeSystem({ tailscale: 'running', sleep: 30 })
    const a = make(userData, sys.exec)
    await a.host.init()
    expect(a.host.status()).toMatchObject({ sharing: false, sleepMinutes: 30, tailscale: { state: 'available' } })

    const on = await a.host.setSharing(true)
    expect(on.sharing).toBe(true)
    expect(a.host.live!.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/ws$/)
    expect(a.awake).toEqual([true])
    expect(a.sharing).toEqual([true])
    expect(a.seen.at(-1)?.sharing).toBe(true)
    const port = on.port
    await a.host.stop()
    expect(a.awake).toEqual([true, false])

    // A new start (after a reboot, say) shares again, on the same port.
    const b = make(userData, sys.exec)
    await b.host.init()
    expect(b.host.status()).toMatchObject({ sharing: true, port })
    expect(JSON.parse(readFileSync(join(userData, 'host.json'), 'utf8'))).toEqual({ sharing: true, port })
  })

  it('runs exactly `tailscale serve --bg <port>` and then shows the https address', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'revive-hostsvc-'))
    let served: number | null = null
    const sys = fakeSystem({ tailscale: 'running', servedPort: () => served })
    const { host } = make(userData, sys.exec)
    await host.init()
    await expect(host.exposeTailscale()).rejects.toThrow(/sharing/)
    const { port } = await host.setSharing(true)
    served = port
    const after = await host.exposeTailscale()
    expect(sys.calls).toContainEqual(['tailscale', 'serve', '--bg', String(port)])
    expect(sys.calls.filter((c) => c[1] === 'serve' && c[2] === '--bg')).toHaveLength(1)
    expect(after.tailscale).toEqual({ state: 'serving', address: 'https://studio-mac.tail1234.ts.net' })
    // The tailnet name is now accepted by the server.
    const res = await fetch(`http://127.0.0.1:${port}/whoami`, { headers: { host: 'studio-mac.tail1234.ts.net' } })
    expect(res.status).toBe(401)
  })

  it('says Tailscale is missing when there is no CLI, and never runs anything else', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'revive-hostsvc-'))
    const sys = fakeSystem({ tailscale: 'missing' })
    const { host } = make(userData, sys.exec)
    await host.init()
    expect(host.status().tailscale.state).toBe('missing')
    expect(sys.calls.some((c) => c.includes('serve'))).toBe(false)
  })

  it('Host mode needs tmux, and says so', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'revive-hostsvc-'))
    const { host } = make(userData, fakeSystem({ tailscale: 'missing' }).exec, { persistentSessions: false })
    await host.init()
    expect(host.status().tmux).toBe(false)
    await expect(host.setSharing(true)).rejects.toThrow(/tmux/)
    expect(host.status().sharing).toBe(false)
  })

  it('pairing needs sharing; start at login goes through the platform', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'revive-hostsvc-'))
    const { host } = make(userData, fakeSystem({ tailscale: 'missing' }).exec)
    await host.init()
    await expect(host.startPairing()).rejects.toThrow(/sharing/)
    await host.setSharing(true)
    const code = await host.startPairing()
    expect(code.code).toMatch(/^\d{6}$/)
    expect(code.link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/pair\?code=\d{6}$/)
    expect(code.qrSvg).toMatch(/^<svg/)
    expect(host.status().pairing?.code).toBe(code.code)
    expect(host.setStartAtLogin(true).startAtLogin).toBe(true)
  })
})
