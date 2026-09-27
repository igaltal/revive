// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@/i18n'
import { AppProviders } from '@/state/AppProviders'
import { App } from '@/App'
import { installMockRevive } from '@/test/mockRevive'
import type { Manifest } from '@shared/manifest'
import { sampleManifest } from '@shared/test-fixtures'

function renderApp() {
  return render(
    <AppProviders>
      <App />
    </AppProviders>
  )
}

function manifestWithStatuses(): Manifest {
  const m = sampleManifest()
  const base = m.projects[0]!
  m.projects = (['running', 'verified', 'unknown', 'broken'] as const).map((status, i) => ({
    ...structuredClone(base),
    id: `p${i}`,
    name: `Project ${i}`,
    path: `p${i}`,
    status,
    description: { en: `English description ${i}`, he: `תיאור בעברית ${i}` }
  }))
  m.projects[1]!.keys = [{ key: 'GOOGLE_MAPS_API_KEY', purpose: { en: 'Shows the map', he: 'מציג את המפה' }, required: true }]
  m.projects[1]!.run = { install: 'npm install', dev: 'npm run dev', port: 5173, url: null, verified_at: null }
  return m
}

const folder = { uiLanguage: 'en' as const, lastFolder: '/Users/noa/ai-projects' }

describe('My projects', () => {
  it('shows one card per project with a status word and the matching action', async () => {
    // "Running now" is never stored; it comes from the live runner.
    installMockRevive(folder, {
      'manifest:get': () => ({ state: 'ok', manifest: manifestWithStatuses() }),
      'runner:list': () => [{ projectId: 'p0', status: 'running', url: 'http://localhost:5173/', port: 5173, reason: null, command: 'npm run dev', updatedAt: '' }]
    })
    renderApp()
    const cards = await screen.findAllByTestId('project-card')
    expect(cards).toHaveLength(4)
    const summary = () => cards.map((c) => [within(c).getByTestId('status-pill').textContent, within(c).getByTestId('card-action').textContent])
    await waitFor(() => expect(summary()[0]![0]).toBe('Running now'))
    expect(summary()).toEqual([
      ['Running now', 'Open'],
      ['Checked and working', 'Start'],
      ['Not checked yet', 'Check if it works'],
      ['Needs fixing', 'Check if it works']
    ])
    expect(screen.getByTestId('gallery').className).toContain('min-[1280px]:grid-cols-4')
    expect(screen.getByTestId('gallery').className).toContain('min-[960px]:grid-cols-3')
    expect(screen.getByTestId('loose-files').textContent).toContain("1 file isn't part of any project.")
  })

  it('shows descriptions in the interface language and switches instantly', async () => {
    installMockRevive(folder, { 'manifest:get': () => ({ state: 'ok', manifest: manifestWithStatuses() }) })
    renderApp()
    expect((await screen.findAllByTestId('project-description'))[0]!.textContent).toBe('English description 0')
    await act(async () => fireEvent.click(screen.getByTestId('lang-he')))
    await waitFor(() => expect(screen.getAllByTestId('project-description')[0]!.textContent).toBe('תיאור בעברית 0'))
  })

  it('opens a project page with commands and key names only under Technical details', async () => {
    installMockRevive(folder, { 'manifest:get': () => ({ state: 'ok', manifest: manifestWithStatuses() }) })
    renderApp()
    fireEvent.click((await screen.findAllByTestId('card-action'))[1]!)
    const page = await screen.findByTestId('project-page')
    expect(within(page).getByText('Shows the map')).toBeTruthy()
    expect(within(page).queryByText('GOOGLE_MAPS_API_KEY')).toBeNull()
    fireEvent.click(within(page).getByText('Technical details'))
    expect(within(page).getByText('npm run dev').getAttribute('dir')).toBe('ltr')
    expect(within(page).getByText('GOOGLE_MAPS_API_KEY').getAttribute('dir')).toBe('ltr')
  })
})

describe('reading the folder', () => {
  it('asks before reading, shows progress full screen, survives a language switch, then shows the result', async () => {
    let manifest: unknown = { state: 'none' }
    const mock = installMockRevive(folder, { 'manifest:get': () => manifest })
    renderApp()
    fireEvent.click(await screen.findByTestId('scan-start'))
    await waitFor(() => expect(mock.calls.some((c) => c.channel === 'scan:start')).toBe(true))

    act(() =>
      mock.emit('scan:progress', { scanId: 'scan-1', phase: 'reading', filesRead: 12, projectsFound: ['bakery-site', 'habit-counter'], recent: ['bakery-site/index.html'] })
    )
    expect((await screen.findByTestId('scan-badge')).textContent).toBe('Reading only')
    expect(screen.getByTestId('scan-files').textContent).toBe('12 files read')
    expect(within(screen.getByTestId('scan-found')).getByText('habit-counter')).toBeTruthy()

    await act(async () => fireEvent.click(screen.getByTestId('lang-he')))
    await waitFor(() => expect(screen.getByTestId('scan-files').textContent).toBe('12 קבצים נקראו'))
    expect(within(screen.getByTestId('scan-found')).getByText('habit-counter')).toBeTruthy()

    manifest = { state: 'ok', manifest: manifestWithStatuses() }
    act(() => mock.emit('scan:done', { scanId: 'scan-1', ok: true, manifest: manifestWithStatuses(), costUsd: 0.04, costParts: [{ step: 'index', model: 'haiku', usd: 0.03 }, { step: 'describe', model: 'sonnet', usd: 0.01 }], versionId: 'v1' }))
    expect((await screen.findByTestId('scan-result')).textContent).toContain('נמצאו 4 פרויקטים.')
    await screen.findAllByTestId('project-card')
  })

  it('explains a scan that touched files outside .revive/ in one sentence, with paths in LTR blocks', async () => {
    const mock = installMockRevive(folder)
    renderApp()
    await screen.findByTestId('scan-start')
    act(() =>
      mock.emit('scan:done', {
        scanId: 'scan-1',
        ok: false,
        costUsd: 0.01,
        costParts: [],
        error: { code: 'modified_outside', restored: ['notes.txt'], quarantined: ['stray.txt'], unrestorable: [] }
      })
    )
    const result = await screen.findByTestId('scan-result')
    expect(within(result).getByTestId('scan-error').textContent).toBe("Claude changed files outside Revive's folder, so Revive put them back the way they were.")
    fireEvent.click(within(result).getByText('Technical details'))
    expect(within(result).getByText('notes.txt').getAttribute('dir')).toBe('ltr')
  })

  it('sends a signed-out scan to the sign-in step', async () => {
    const mock = installMockRevive(folder, { 'prereq:check': () => ({ claude: { installed: true, version: '2', signedIn: 'no' }, git: { installed: true, version: '2' }, node: { installed: true, version: '24' }, codex: { installed: false, version: null }, checkedAt: '' }) })
    renderApp()
    await screen.findByTestId('scan-start')
    act(() => mock.emit('scan:done', { scanId: 'scan-1', ok: false, costUsd: null, costParts: [], error: { code: 'auth' } }))
    fireEvent.click(within(await screen.findByTestId('scan-result')).getByText('Sign in'))
    await screen.findByTestId('panel-sign-in')
  })
})

describe('reading the folder: first moments', () => {
  it('says "Reading your folder" instead of "0 files read" until the first file arrives', async () => {
    const mock = installMockRevive(folder)
    renderApp()
    fireEvent.click(await screen.findByTestId('scan-start'))
    await screen.findByTestId('scan-badge')
    expect(screen.getByTestId('scan-files').getAttribute('data-state')).toBe('waiting')
    act(() => mock.emit('scan:progress', { scanId: 'scan-1', phase: 'reading', filesRead: 0, projectsFound: [], recent: [] }))
    expect(screen.getByTestId('scan-files').textContent).toBe('Reading your folder…')
    expect(screen.queryByText('0 files read')).toBeNull()
    act(() => mock.emit('scan:progress', { scanId: 'scan-1', phase: 'reading', filesRead: 1, projectsFound: [], recent: ['a/index.html'] }))
    expect(screen.getByTestId('scan-files').textContent).toBe('1 file read')
    act(() => mock.emit('scan:progress', { scanId: 'scan-1', phase: 'describing', filesRead: 9, projectsFound: ['a'], recent: [] }))
    expect(screen.getByTestId('scan-phase').textContent).toContain('Writing a short description of each project.')
  })

  it('shows the total cost, and each step with its model under Technical details', async () => {
    const mock = installMockRevive(folder, { 'manifest:get': () => ({ state: 'ok', manifest: manifestWithStatuses() }) })
    renderApp()
    await screen.findAllByTestId('project-card')
    act(() =>
      mock.emit('scan:done', {
        scanId: 's',
        ok: true,
        manifest: manifestWithStatuses(),
        costUsd: 0.075,
        costParts: [
          { step: 'index', model: 'haiku', usd: 0.05 },
          { step: 'describe', model: 'sonnet', usd: 0.025 }
        ],
        versionId: 'v'
      })
    )
    const result = await screen.findByTestId('scan-result')
    expect(within(result).getByTestId('scan-cost').textContent).toBe('Claude reported this reading as about $0.08 of usage.')
    fireEvent.click(within(result).getByText('Technical details'))
    expect(within(result).getByText(/describe\s+sonnet\s+\$0\.0250/)).toBeTruthy()
  })

  it("blocks everything, loudly, when Claude Code didn't stop at the turn limit", async () => {
    installMockRevive(folder, { 'guard:status': () => ({ state: 'failed', version: '9.9.9', detail: ['Claude kept going past the one-turn limit.'] }) })
    renderApp()
    const blocked = await screen.findByTestId('guard-blocked')
    expect(blocked.textContent).toContain("Revive can't safely use this version of Claude Code")
    expect(blocked.textContent).toContain('Claude Code 9.9.9')
    expect(screen.queryByTestId('scan-start')).toBeNull()
  })
})

describe('start, preview and stop', () => {
  const running = (patch = {}) => ({ projectId: 'p2', status: 'running', url: 'http://localhost:5173/', port: 5173, reason: null, command: 'npm run dev', updatedAt: '', ...patch })
  const event = (seq: number, state: object) => ({ type: 'status.changed' as const, state: state as never, seq, at: '' })

  it('starts from the card and opens the page, which follows the run to a live preview', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 100, left: 300, bottom: 660, right: 1200, width: 900, height: 560, x: 300, y: 100, toJSON: () => ({}) })
    const mock = installMockRevive(folder, {
      'manifest:get': () => ({ state: 'ok', manifest: manifestWithStatuses() }),
      'runner:start': (a) => running({ projectId: (a as { projectId: string }).projectId, status: 'installing', url: null, port: null })
    })
    renderApp()
    fireEvent.click((await screen.findAllByTestId('card-action'))[2]!)
    await screen.findByTestId('project-page')
    expect(mock.calls.find((c) => c.channel === 'runner:start')?.args).toEqual({ projectId: 'p2' })
    expect((await screen.findByTestId('run-progress')).textContent).toContain('Getting the parts this project needs.')
    expect(screen.getByTestId('status-pill').getAttribute('data-phase')).toBe('installing')

    act(() => mock.emit('runtime:event', event(1, running({ status: 'checking' }))))
    expect(screen.getByTestId('run-progress').textContent).toContain('Checking that it opens.')
    act(() => mock.emit('runtime:event', event(2, running())))
    expect(await screen.findByTestId('preview-frame')).toBeTruthy()
    await waitFor(() => expect(mock.calls.find((c) => c.channel === 'preview:show')?.args).toEqual({ projectId: 'p2', device: 'desktop', bounds: { x: 300, y: 100, width: 900, height: 560 } }))

    fireEvent.click(screen.getByTestId('device-phone'))
    await waitFor(() => expect(mock.calls.filter((c) => c.channel === 'preview:show').at(-1)?.args).toMatchObject({ device: 'phone' }))
    fireEvent.click(screen.getByTestId('preview-open'))
    expect(mock.calls.at(-1)).toEqual({ channel: 'preview:openInBrowser', args: { projectId: 'p2' } })

    fireEvent.click(screen.getByTestId('project-stop'))
    expect(mock.calls.some((c) => c.channel === 'runner:stop')).toBe(true)
    act(() => mock.emit('runtime:event', event(3, running({ status: 'stopped', url: null }))))
    await waitFor(() => expect(screen.queryByTestId('preview-frame')).toBeNull())
    expect(mock.calls.at(-1)?.channel).toBe('preview:hide')
    rect.mockRestore()
  })

  it('explains a failed start in one sentence, using the key purpose rather than its name', async () => {
    const mock = installMockRevive(folder, { 'manifest:get': () => ({ state: 'ok', manifest: manifestWithStatuses() }) })
    renderApp()
    fireEvent.click((await screen.findAllByTestId('card-action'))[1]!)
    await screen.findByTestId('project-page')
    act(() => mock.emit('runtime:event', event(1, running({ projectId: 'p1', status: 'broken', reason: { code: 'missing_key', key: 'GOOGLE_MAPS_API_KEY' } }))))
    const reason = await screen.findByTestId('run-reason')
    expect(reason.textContent).toContain('It stopped because a key is missing: Shows the map.')
    expect(reason.textContent).not.toContain('GOOGLE_MAPS_API_KEY')
    fireEvent.click(within(reason).getByTestId('run-retry'))
    expect(mock.calls.filter((c) => c.channel === 'runner:start').at(-1)?.args).toEqual({ projectId: 'p1' })
  })

  it('shows the picture from the last start on the card, through the revive:// protocol', async () => {
    installMockRevive(folder, { 'manifest:get': () => ({ state: 'ok', manifest: manifestWithStatuses() }), 'shots:list': () => ({ p1: '/shots/p1.png?v=7' }) })
    renderApp()
    const img = await screen.findByTestId('project-picture')
    expect(img.getAttribute('src')).toBe('revive://local/shots/p1.png?v=7')
  })
})
