// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@/i18n'
import { SettingsProvider } from '@/state/settings'
import { ProjectsProvider } from '@/state/projects'
import { App } from '@/App'
import { installMockRevive } from '@/test/mockRevive'
import type { Manifest } from '@shared/manifest'
import { sampleManifest } from '@shared/test-fixtures'

function renderApp() {
  return render(
    <SettingsProvider>
      <ProjectsProvider>
        <App />
      </ProjectsProvider>
    </SettingsProvider>
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
    installMockRevive(folder, { 'manifest:get': () => ({ state: 'ok', manifest: manifestWithStatuses() }) })
    renderApp()
    const cards = await screen.findAllByTestId('project-card')
    expect(cards).toHaveLength(4)
    const summary = cards.map((c) => [within(c).getByText(/Running now|Checked and working|Not checked yet|Needs fixing/).textContent, within(c).getByTestId('card-action').textContent])
    expect(summary).toEqual([
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
    act(() => mock.emit('scan:done', { scanId: 'scan-1', ok: true, manifest: manifestWithStatuses(), costUsd: 0.04, versionId: 'v1' }))
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
    act(() => mock.emit('scan:done', { scanId: 'scan-1', ok: false, costUsd: null, error: { code: 'auth' } }))
    fireEvent.click(within(await screen.findByTestId('scan-result')).getByText('Sign in'))
    await screen.findByTestId('panel-sign-in')
  })
})
