import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '@shared/update'
import { channelFor, CHECK_EVERY_MS, FIRST_CHECK_MS, UpdateService, type Timers, type Updater } from './updates'

function fakeUpdater() {
  const handlers = new Map<string, (arg?: unknown) => void>()
  const u = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    allowDowngrade: true,
    channel: null as string | null,
    checks: 0,
    installs: 0,
    on(e: string, fn: (arg?: unknown) => void) {
      handlers.set(e, fn)
      return u
    },
    async checkForUpdates() {
      u.checks++
      return null
    },
    quitAndInstall() {
      u.installs++
    },
    fire: (e: string, arg?: unknown) => handlers.get(e)?.(arg)
  }
  return u as typeof u & Updater
}

function fakeTimers() {
  let now = 0
  const list: Array<{ at: number; every: number | null; fn: () => void; on: boolean }> = []
  const t: Timers = {
    after: (ms, fn) => {
      const x = { at: now + ms, every: null, fn, on: true }
      list.push(x)
      return () => (x.on = false)
    },
    every: (ms, fn) => {
      const x = { at: now + ms, every: ms, fn, on: true }
      list.push(x)
      return () => (x.on = false)
    }
  }
  const advance = (ms: number) => {
    const end = now + ms
    for (;;) {
      const due = list.filter((x) => x.on && x.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      now = due.at
      if (due.every) due.at += due.every
      else due.on = false
      due.fn()
    }
    now = end
  }
  return { t, advance }
}

describe('updates', () => {
  it('stable unless the build is a prerelease, or the environment picks the channel', () => {
    expect(channelFor('0.11.0')).toBe('latest')
    expect(channelFor('0.12.0-beta.2')).toBe('beta')
    expect(channelFor('1.0.0-rc.1')).toBe('beta')
    expect(channelFor('0.11.0', 'beta')).toBe('beta')
    expect(channelFor('0.12.0-beta.1', 'latest')).toBe('latest')
  })

  it('downloads in the background and installs on the next quit; beta builds follow beta', () => {
    const u = fakeUpdater()
    new UpdateService(u, { version: '0.12.0-beta.1' }, () => {})
    expect(u).toMatchObject({ autoDownload: true, autoInstallOnAppQuit: true, allowDowngrade: false, allowPrerelease: true, channel: 'beta' })
    const s = fakeUpdater()
    new UpdateService(s, { version: '0.11.0' }, () => {})
    expect(s).toMatchObject({ allowPrerelease: false, channel: 'latest' })
  })

  it('checks a minute after launch and every six hours', () => {
    const u = fakeUpdater()
    const { t, advance } = fakeTimers()
    new UpdateService(u, { version: '0.11.0' }, () => {}, t).start()
    advance(FIRST_CHECK_MS - 1)
    expect(u.checks).toBe(0)
    advance(1)
    expect(u.checks).toBe(1)
    advance(CHECK_EVERY_MS * 2)
    expect(u.checks).toBe(3)
  })

  it('says "ready" once downloaded, and never restarts on its own, however long it waits', () => {
    const u = fakeUpdater()
    const { t, advance } = fakeTimers()
    const seen: UpdateStatus[] = []
    const svc = new UpdateService(u, { version: '0.11.0' }, (s) => seen.push(s), t)
    svc.start()
    u.fire('update-available', { version: '0.11.1' })
    u.fire('download-progress', { percent: 42.4 })
    u.fire('update-downloaded', { version: '0.11.1' })
    expect(svc.current()).toMatchObject({ state: 'ready', version: '0.11.1', percent: 100 })
    expect(seen.map((s) => s.state)).toEqual(['downloading', 'downloading', 'ready'])
    // A later check or a failed one doesn't hide it.
    u.fire('checking-for-update')
    u.fire('error', new Error('offline'))
    expect(svc.current().state).toBe('ready')
    advance(30 * 24 * 3600_000)
    expect(u.installs).toBe(0)
    // Only when the person asks.
    svc.install()
    expect(u.installs).toBe(1)
  })

  it('does nothing when asked to install before anything is ready', () => {
    const u = fakeUpdater()
    const svc = new UpdateService(u, { version: '0.11.0' }, () => {})
    svc.install()
    expect(u.installs).toBe(0)
  })
})
