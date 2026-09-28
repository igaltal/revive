// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@/i18n'
import { applyLanguage } from '@/i18n'
import { sampleManifest } from '@shared/test-fixtures'
import { DEFAULT_APPEARANCE, type Appearance } from '@shared/appearance'
import { capabilitiesFor } from '@shared/contract'
import type { Vitals } from '@shared/vitals'
import { AppProviders } from '@/state/AppProviders'
import { App } from '@/App'
import { installMockRevive } from '@/test/mockRevive'
import { homeBlocks, orderedProjects } from './HomeScreen'
import { saverAlertFor, useIdle } from '@/components/Screensaver'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 100
    rows = 30
    loadAddon() {}
    open() {}
    focus() {}
    write() {}
    reset() {}
    onData() {
      return { dispose: () => {} }
    }
    dispose() {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  applyLanguage('en')
})

const folder = { uiLanguage: 'en' as const, lastFolder: '/Users/noa/ai-projects' }
const connected = { state: 'open' as const, host: { name: 'Studio Mac', address: 'https://studio.ts.net' }, problem: null, capabilities: capabilitiesFor('ws') }
const renderApp = () =>
  render(
    <AppProviders>
      <App />
    </AppProviders>
  )

const VITALS: Vitals = {
  at: '2026-09-28T16:00:00.000Z',
  machine: { name: 'Mac mini M4', cpu: 'Apple M4', cores: 10, memoryBytes: 24 * 1024 ** 3 },
  cpu: 18,
  memory: 59,
  disk: 41,
  temperature: 46,
  uptimeSeconds: 17 * 86_400 + 3600,
  cpuHistory: [10, 20, 18],
  tailscale: 'serving',
  ollama: { state: 'running', models: ['qwen3:14b'] },
  devicesOnline: 3
}

function hostWith(look: Partial<Appearance> = {}, handlers: Parameters<typeof installMockRevive>[1] = {}) {
  return installMockRevive(folder, {
    'client:status': () => connected,
    'appearance:get': () => ({ ...DEFAULT_APPEARANCE, ...look }),
    'manifest:get': () => ({ state: 'ok', manifest: sampleManifest() }),
    'vitals:watch': () => ({ leaseId: 'aaaaaaaaaaaaaaaa', vitals: VITALS }),
    ...handlers
  })
}

describe('Home', () => {
  it('is the first screen on another computer’s window, in the Scenic look', async () => {
    hostWith()
    renderApp()
    const home = await screen.findByTestId('home')
    expect(document.documentElement.dataset['theme']).toBe('scenic')
    expect(screen.getByTestId('home-clock')).toBeTruthy()
    expect(screen.getByTestId('home-connection').textContent).toBe('Studio MacConnected')
    expect((await screen.findByTestId('home-tailscale')).textContent).toContain('Tailscale secured')
    // Live status on every project tile, the Host's health, agents and services, uptime.
    await waitFor(() => expect(within(home).getAllByTestId('home-tile').length).toBe(sampleManifest().projects.length))
    expect(within(home).getAllByTestId('vitals-gauge').map((g) => g.textContent)).toEqual(['CPU18%', 'Memory59%', 'Disk41%', 'Temp46°C'])
    expect(screen.getByTestId('home-uptime').textContent).toContain('17 days')
    const live = screen.getAllByTestId('home-live-item').map((i) => i.textContent)
    expect(live).toEqual(expect.arrayContaining(['Ollama qwen3:14b loaded', 'Revive Host 3 devices connected', 'Tailscale sharing this computer']))
  })

  it('is one click away in local mode, which stays in the Paper look', async () => {
    installMockRevive(folder, { 'manifest:get': () => ({ state: 'ok', manifest: sampleManifest() }) })
    renderApp()
    await screen.findAllByTestId('project-card')
    expect(document.documentElement.dataset['theme']).toBe('paper')
    fireEvent.click(screen.getByTestId('nav-home'))
    expect(await screen.findByTestId('home')).toBeTruthy()
  })

  it('shows a tile as failed when its run fails, and updates vitals live from the stream', async () => {
    const mock = hostWith()
    renderApp()
    await screen.findByTestId('home')
    act(() =>
      mock.emit('runtime:event', { type: 'status.changed', seq: 5, at: '', state: { projectId: 'bakery-site', status: 'broken', url: null, port: null, reason: { code: 'exited' }, command: null, updatedAt: '' } })
    )
    await waitFor(() => expect(screen.getAllByTestId('home-tile').find((t) => t.dataset['project'] === 'bakery-site')!.dataset['status']).toBe('failed'))
    act(() => mock.emit('runtime:event', { type: 'vitals.updated', seq: 6, at: '', vitals: { ...VITALS, cpu: 77 } }))
    await waitFor(() => expect(screen.getAllByTestId('vitals-gauge')[0]!.textContent).toBe('CPU77%'))
  })

  it('command bar: pick a project and an agent, and that session opens', async () => {
    const mock = hostWith({}, { 'sessions:open': (a) => ({ ok: true, sessionId: `${(a as { projectId: string }).projectId}:${(a as { kind: string }).kind}`, created: true }) })
    renderApp()
    await screen.findByTestId('home')
    fireEvent.click(screen.getByTestId('agent-codex'))
    fireEvent.focus(screen.getByTestId('command-input'))
    fireEvent.change(screen.getByTestId('command-input'), { target: { value: 'bake' } })
    fireEvent.click(await screen.findByTestId('command-option'))
    fireEvent.click(screen.getByTestId('command-go'))
    await screen.findByTestId('terminal-screen')
    expect(mock.calls.find((c) => c.channel === 'sessions:open')?.args).toEqual({ projectId: 'bakery-site', kind: 'codex' })
  })

  it('asks for a project first, and shows why an agent cannot start', async () => {
    const mock = hostWith({}, { 'sessions:open': () => ({ ok: false, kind: 'claude', problem: 'not_installed' }) })
    renderApp()
    await screen.findByTestId('home')
    fireEvent.change(screen.getByTestId('command-input'), { target: { value: 'nothing like this' } })
    fireEvent.click(screen.getByTestId('command-go'))
    expect(mock.calls.some((c) => c.channel === 'sessions:open')).toBe(false)
    fireEvent.change(screen.getByTestId('command-input'), { target: { value: 'Sunrise Bakery' } })
    fireEvent.click(screen.getByTestId('command-go'))
    expect((await screen.findByTestId('agent-problem', {}, { timeout: 5000 })).textContent).toContain('Claude Code')
  })

  it('stops watching vitals when Home is left', async () => {
    const mock = hostWith()
    renderApp()
    await screen.findByTestId('home')
    await waitFor(() => expect(mock.calls.some((c) => c.channel === 'vitals:watch')).toBe(true))
    fireEvent.click(screen.getByTestId('nav-projects'))
    await waitFor(() => expect(mock.calls.find((c) => c.channel === 'vitals:unwatch')?.args).toEqual({ leaseId: 'aaaaaaaaaaaaaaaa' }))
  })

  it('follows the widget order and visibility, and pinned projects come first', () => {
    const w = DEFAULT_APPEARANCE.widgets
    expect(homeBlocks(w)).toEqual(['command', 'tiles', ['vitals', 'agents', 'uptime']])
    expect(homeBlocks([w[2]!, w[0]!, { id: 'tiles', visible: false }, w[3]!, w[4]!])).toEqual([['vitals'], 'command', ['agents', 'uptime']])
    const projects = sampleManifest().projects
    const last = projects.at(-1)!
    expect(orderedProjects(projects, { [last.id]: { icon: null, color: null, pinned: true } })[0]!.id).toBe(last.id)
  })

  it('in Hebrew: right to left, with the date and uptime in Hebrew', async () => {
    installMockRevive({ ...folder, uiLanguage: 'he' }, { 'client:status': () => connected, 'manifest:get': () => ({ state: 'ok', manifest: sampleManifest() }), 'vitals:watch': () => ({ leaseId: 'aaaaaaaaaaaaaaaa', vitals: VITALS }) })
    renderApp()
    await screen.findByTestId('home')
    expect(document.documentElement.dir).toBe('rtl')
    await waitFor(() => expect(screen.getByTestId('home-uptime').textContent).toContain('17 ימים'))
    expect(screen.getByTestId('home-connection').querySelector('bdi')!.textContent).toBe('Studio Mac')
    expect(screen.getByTestId('home-connection').textContent).toContain('מחובר')
  })
})

describe('the screensaver', () => {
  it('starts after the idle time, and any key brings the app back', () => {
    vi.useFakeTimers()
    let state: boolean[] = []
    function Probe() {
      const [idle] = useIdle(1)
      state.push(idle)
      return null
    }
    render(<Probe />)
    act(() => vi.advanceTimersByTime(59_000))
    expect(state.at(-1)).toBe(false)
    act(() => vi.advanceTimersByTime(2000))
    expect(state.at(-1)).toBe(true)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    })
    expect(state.at(-1)).toBe(false)
    state = []
  })

  it('never starts when set to never', () => {
    vi.useFakeTimers()
    const seen: boolean[] = []
    function Probe() {
      seen.push(useIdle(0)[0])
      return null
    }
    render(<Probe />)
    act(() => vi.advanceTimersByTime(24 * 3600_000))
    expect(seen.every((x) => !x)).toBe(true)
  })

  it('wakes on a failing run session: a glow in the status color and one line naming it', async () => {
    const mock = hostWith({ screensaver: { mode: 'dark', idleMinutes: 5, wake: { waiting: true, failed: true, finished: false } } })
    renderApp()
    await screen.findByTestId('home')
    // Customize → "Try it now" shows the screensaver as it would appear.
    fireEvent.click(screen.getByTestId('home-customize'))
    fireEvent.click(await screen.findByTestId('saver-preview'))
    const saver = await screen.findByTestId('screensaver')
    expect(saver.dataset['mode']).toBe('dark')
    expect(saver.dataset['alert']).toBe('')
    act(() =>
      mock.emit('runtime:event', { type: 'status.changed', seq: 9, at: '', state: { projectId: 'bakery-site', status: 'broken', url: null, port: null, reason: { code: 'exited' }, command: null, updatedAt: '' } })
    )
    expect((await screen.findByTestId('screensaver-alert')).textContent).toBe('Sunrise Bakery stopped working')
    expect(saver.dataset['alert']).toBe('failed')
    expect(saver.getAttribute('style')).toContain('inset 0 0 160px')
    fireEvent.pointerDown(saver)
    await waitFor(() => expect(screen.queryByTestId('screensaver')).toBeNull())
  })

  it('wakes only for what was chosen', () => {
    const projects = sampleManifest().projects
    const failedRun = { type: 'status.changed' as const, seq: 1, at: '', state: { projectId: 'bakery-site', status: 'broken' as const, url: null, port: null, reason: null, command: null, updatedAt: '' } }
    const agentDone = { type: 'process.exited' as const, seq: 2, at: '', session: { projectId: 'bakery-site', kind: 'claude' as const }, step: 'terminal' as const, exitCode: 0, signal: null }
    const agentFailed = { ...agentDone, exitCode: 1 }
    const all = { waiting: true, failed: true, finished: true }
    expect(saverAlertFor(failedRun, projects, all)).toMatchObject({ kind: 'failed', values: { project: 'Sunrise Bakery' } })
    expect(saverAlertFor(failedRun, projects, { ...all, failed: false })).toBeNull()
    expect(saverAlertFor(agentFailed, projects, all)).toMatchObject({ kind: 'failed', key: 'saver.alert.agentFailed' })
    expect(saverAlertFor(agentDone, projects, all)).toMatchObject({ kind: 'finished' })
    expect(saverAlertFor(agentDone, projects, { ...all, finished: false })).toBeNull()
  })
})

describe('the scene’s motion', () => {
  it('is off when the system asks for reduced motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {} }))
    hostWith()
    renderApp()
    await screen.findByTestId('home')
    expect(screen.getByTestId('scene-backdrop').dataset['motionFps']).toBe('0')
  })

  it('runs a few frames a second otherwise, and the user can turn it off', async () => {
    hostWith({ motion: 'full' })
    renderApp()
    await screen.findByTestId('home')
    expect(screen.getByTestId('scene-backdrop').dataset['motionFps']).toBe('8')
  })
})
