// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@/i18n'
import { sampleManifest } from '@shared/test-fixtures'
import { AppProviders } from '@/state/AppProviders'
import { App } from '@/App'
import { installMockRevive } from '@/test/mockRevive'

// xterm.js needs a real browser to draw; a stand-in records what it's given.
const terms: Array<{ written: string[]; resets: number; onData?: (d: string) => void }> = []
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 100
    rows = 30
    rec = { written: [] as string[], resets: 0, onData: undefined as ((d: string) => void) | undefined }
    constructor() {
      terms.push(this.rec)
    }
    loadAddon() {}
    open() {}
    focus() {}
    write(d: string, done?: () => void) {
      this.rec.written.push(d)
      // Like xterm.js: finished parsing later, not during the call.
      if (done) setTimeout(done, 50)
    }
    reset() {
      this.rec.resets += 1
    }
    onData(fn: (d: string) => void) {
      this.rec.onData = fn
      return { dispose: () => {} }
    }
    dispose() {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

const folder = { uiLanguage: 'en' as const, lastFolder: '/Users/noa/ai-projects' }
const renderApp = () =>
  render(
    <AppProviders>
      <App />
    </AppProviders>
  )

async function openTerminal(handlers: Parameters<typeof installMockRevive>[1] = {}) {
  const mock = installMockRevive(folder, {
    'manifest:get': () => ({ state: 'ok', manifest: sampleManifest() }),
    'sessions:open': (a) => ({ ok: true, sessionId: `${(a as { projectId: string }).projectId}:${(a as { kind: string }).kind}`, created: true }),
    'sessions:list': () => [{ sessionId: 'bakery-site:claude', projectId: 'bakery-site', kind: 'claude', step: 'terminal' }],
    ...handlers
  })
  renderApp()
  fireEvent.click((await screen.findAllByTestId('card-action'))[0]!)
  fireEvent.click(await screen.findByTestId('terminal-open-claude'))
  await screen.findByTestId('terminal-screen')
  return mock
}

describe('the terminal screen', () => {
  it('opens Claude Code from the project page, shows its output, and sends keystrokes and size through the transport', async () => {
    terms.length = 0
    const mock = await openTerminal()
    expect(mock.calls.find((c) => c.channel === 'sessions:open')?.args).toEqual({ projectId: 'bakery-site', kind: 'claude' })
    expect(screen.getByTestId('terminal-view').getAttribute('dir')).toBe('ltr')
    const tab = await screen.findByTestId('terminal-tab')
    expect(tab.textContent).toBe('Claude Code')

    act(() => mock.emit('session:output', { sessionId: 'bakery-site:claude', offset: 0, epoch: 'e1', data: '╭ Claude Code ╮\r\n' }))
    await waitFor(() => expect(terms.at(-1)!.written.join('')).toContain('Claude Code ╮'))
    terms.at(-1)!.onData!('hello\r')
    expect(mock.calls.find((c) => c.channel === 'session:input')?.args).toEqual({ sessionId: 'bakery-site:claude', data: 'hello\r' })
    expect(mock.calls.find((c) => c.channel === 'session:resize')?.args).toEqual({ sessionId: 'bakery-site:claude', cols: 100, rows: 30 })

    // The Host restarted and rebuilt the session's output: the screen starts over.
    act(() => mock.emit('session:output', { sessionId: 'bakery-site:claude', offset: 0, epoch: 'e2', data: 'rebuilt history\r\n' }))
    await waitFor(() => expect(terms.at(-1)!.resets).toBe(1))
    expect(terms.at(-1)!.written.at(-1)).toBe('rebuilt history\r\n')
  })

  it('replaying a session’s history never answers its old terminal questions again', async () => {
    terms.length = 0
    const mock = await openTerminal()
    const inputs = () => mock.calls.filter((c) => c.channel === 'session:input').map((c) => (c.args as { data: string }).data)
    // History: the shell asked "what terminal are you?" when it started, long ago.
    act(() => mock.emit('session:output', { sessionId: 'bakery-site:claude', offset: 0, epoch: 'e1', data: 'prompt\x1b[c\x1b[>c> ' }))
    await waitFor(() => expect(terms.at(-1)!.written.join('')).toContain('prompt'))
    // xterm.js answers while replaying it: dropped. What the person types still goes through.
    terms.at(-1)!.onData!('\x1b[?1;2c')
    terms.at(-1)!.onData!('\x1b[>0;276;0c')
    terms.at(-1)!.onData!('ls\r')
    expect(inputs()).toEqual(['ls\r'])
    // Once the history is drawn, a program asking now gets its answer.
    await new Promise((r) => setTimeout(r, 250))
    act(() => mock.emit('session:output', { sessionId: 'bakery-site:claude', offset: 15, epoch: 'e1', data: '\x1b[c' }))
    terms.at(-1)!.onData!('\x1b[?1;2c')
    expect(inputs()).toEqual(['ls\r', '\x1b[?1;2c'])
  })

  it('going back only detaches; ending the session asks first', async () => {
    const mock = await openTerminal()
    fireEvent.click(screen.getByTestId('terminal-end'))
    const confirm = await screen.findByTestId('terminal-end-confirm')
    expect(confirm.textContent).toContain('Claude Code stops, with anything still running in it.')
    expect(mock.calls.some((c) => c.channel === 'sessions:close')).toBe(false)
    fireEvent.click(within(confirm).getByText('Cancel'))
    fireEvent.click(screen.getByTestId('terminal-back'))
    await screen.findByTestId('project-page')
    expect(mock.calls.some((c) => c.channel === 'sessions:close')).toBe(false)

    fireEvent.click(screen.getByTestId('terminal-open-claude'))
    fireEvent.click(await screen.findByTestId('terminal-end'))
    fireEvent.click(within(await screen.findByTestId('terminal-end-confirm')).getByTestId('terminal-end-confirm-button'))
    expect(mock.calls.find((c) => c.channel === 'sessions:close')?.args).toEqual({ sessionId: 'bakery-site:claude', confirm: true })
  })

  it('without tmux, says in one line that sessions stop with Revive, and how to fix it', async () => {
    await openTerminal({ 'sessions:info': () => ({ backend: 'pty', persistent: false, tmuxVersion: null, orphans: [] }) })
    const banner = await screen.findByTestId('terminal-banner')
    expect(banner.textContent).toContain('Sessions stop when Revive quits.')
    expect(within(banner).getByText('brew install tmux').getAttribute('dir')).toBe('ltr')
    fireEvent.click(screen.getByText('Technical details'))
    expect(screen.getByTestId('terminal-hebrew-note').textContent).toBe('Hebrew inside the terminal is shown left to right.')
  })
})

describe('an agent that can’t start', () => {
  it('says why in one sentence, with the step, and opens nothing', async () => {
    const mock = installMockRevive(folder, {
      'manifest:get': () => ({ state: 'ok', manifest: sampleManifest() }),
      'sessions:open': () => ({ ok: false, kind: 'claude', problem: 'signed_out' })
    })
    renderApp()
    fireEvent.click((await screen.findAllByTestId('card-action'))[0]!)
    fireEvent.click(await screen.findByTestId('terminal-open-claude'))
    const notice = await screen.findByTestId('agent-problem')
    expect(notice.textContent).toContain("You're signed out of Claude Code. Sign in, then open it again.")
    expect(screen.queryByTestId('terminal-screen')).toBeNull()
    fireEvent.click(within(notice).getByTestId('agent-fix'))
    expect(mock.calls.some((c) => c.channel === 'prereq:signIn')).toBe(true)
  })

  it('on another computer’s window, says where the step happens', async () => {
    const { capabilitiesFor } = await import('@shared/contract')
    installMockRevive(folder, {
      'client:status': () => ({ state: 'open', host: { name: 'Studio Mac', address: 'https://studio.ts.net' }, problem: null, capabilities: capabilitiesFor('ws') }),
      'manifest:get': () => ({ state: 'ok', manifest: sampleManifest() }),
      'sessions:open': () => ({ ok: false, kind: 'codex', problem: 'signed_out' })
    })
    renderApp()
    fireEvent.click(await screen.findByTestId('nav-projects'))
    fireEvent.click((await screen.findAllByTestId('card-action'))[0]!)
    fireEvent.click(await screen.findByTestId('terminal-open-codex'))
    const notice = await screen.findByTestId('agent-problem')
    expect(notice.textContent).toContain("You're signed out of Codex.")
    expect(within(notice).getByText('codex login').getAttribute('dir')).toBe('ltr')
    expect(notice.textContent).toContain('This has to be done on Studio Mac, the computer that runs Revive.')
    expect(within(notice).queryByTestId('agent-fix')).toBeNull()
  })
})

describe('sessions in Settings', () => {
  it('keeps agents running by default, lists orphans and ends one only after confirming', async () => {
    const mock = installMockRevive(folder, {
      'sessions:info': () => ({ backend: 'tmux', persistent: true, tmuxVersion: '3.7c', orphans: [{ name: 'revive-old-project-claude', projectId: 'old-project', kind: 'claude', createdAt: null }] }),
      'sessions:endOrphan': () => ({ backend: 'tmux', persistent: true, tmuxVersion: '3.7c', orphans: [] })
    })
    renderApp()
    fireEvent.click(await screen.findByTestId('nav-settings'))
    expect((await screen.findByTestId('keep-agents')).getAttribute('aria-checked')).toBe('true')
    const row = await screen.findByTestId('orphan-row')
    expect(row.textContent).toContain('old-project · Claude Code')
    fireEvent.click(within(row).getByTestId('orphan-end'))
    expect(mock.calls.some((c) => c.channel === 'sessions:endOrphan')).toBe(false)
    fireEvent.click(within(await screen.findByTestId('orphan-confirm')).getByTestId('orphan-end-confirm'))
    expect(mock.calls.find((c) => c.channel === 'sessions:endOrphan')?.args).toEqual({ name: 'revive-old-project-claude', confirm: true })
    await waitFor(() => expect(screen.queryByTestId('orphan-row')).toBeNull())
  })

  it('without tmux: the switch is off with the reason, and Host mode says it needs tmux', async () => {
    installMockRevive(folder, {
      'sessions:info': () => ({ backend: 'pty', persistent: false, tmuxVersion: null, orphans: [] }),
      'host:status': () => ({ sharing: false, port: null, hostName: 'Studio Mac', tailscale: { state: 'missing', address: null }, sleepMinutes: 0, tmux: false, startAtLogin: false, pairing: null, lockedUntil: null, requests: [], devices: [] })
    })
    renderApp()
    fireEvent.click(await screen.findByTestId('nav-settings'))
    const keep = await screen.findByTestId('keep-agents')
    await waitFor(() => expect(keep.getAttribute('aria-checked')).toBe('false'))
    expect((keep as HTMLButtonElement).disabled).toBe(true)
    expect((await screen.findByTestId('sharing-needs-tmux')).textContent).toContain('Host mode needs tmux')
    expect((screen.getByTestId('sharing-switch') as HTMLButtonElement).disabled).toBe(true)
  })
})
