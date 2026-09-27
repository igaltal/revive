// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@/i18n'
import { AppProviders } from '@/state/AppProviders'
import { App } from '@/App'
import { installMockRevive } from '@/test/mockRevive'
import type { VersionSummary } from '@shared/versions'
import { sampleManifest } from '@shared/test-fixtures'

const folder = { uiLanguage: 'en' as const, lastFolder: '/Users/noa/ai-projects' }
const VERSIONS: VersionSummary[] = [
  { id: 'v-20260928T090000Z-bbbbb', kind: 'restore', title: { en: 'x', he: 'x' }, createdAt: '2026-09-28T09:00:00.000Z', restoredFrom: 'v-20260927T080000Z-aaaaa' },
  { id: 'v-20260927T080000Z-aaaaa', kind: 'scan', title: { en: 'Before reading the folder', he: 'לפני קריאת התיקייה' }, createdAt: '2026-09-27T08:00:00.000Z' }
]
const restored = { type: 'version.restored' as const, how: 'restore' as const, versionId: VERSIONS[1]!.id, undoVersionId: VERSIONS[0]!.id, changedFiles: 3, stoppedProjects: ['bakery-site'], seq: 9, at: '' }

function renderApp() {
  return render(
    <AppProviders>
      <App />
    </AppProviders>
  )
}

async function openHistory(handlers: Parameters<typeof installMockRevive>[1] = {}) {
  const mock = installMockRevive(folder, { 'manifest:get': () => ({ state: 'ok', manifest: sampleManifest() }), 'versions:list': () => VERSIONS, ...handlers })
  renderApp()
  fireEvent.click(await screen.findByTestId('nav-history'))
  await screen.findAllByTestId('version-row')
  return mock
}

describe('History', () => {
  it('lists saved versions newest first, with plain titles and times', async () => {
    await openHistory()
    const titles = screen.getAllByTestId('version-title').map((t) => t.textContent)
    expect(titles[0]).toMatch(/^Before going back to the version from Sep 27, 2026/)
    expect(titles[1]).toBe('Before reading the folder')
    expect(screen.getByText('Keys are never included in saved versions.')).toBeTruthy()
  })

  it('goes back only after showing what will change, then offers Undo and to start what was stopped', async () => {
    const mock = await openHistory({
      'versions:preview': () => ({ versionId: VERSIONS[1]!.id, changedFiles: 3, newFiles: 1, sample: ['bakery-site/index.html'], willStop: ['bakery-site'] }),
      'versions:restore': () => ({ ok: true, versionId: VERSIONS[1]!.id, undoVersionId: VERSIONS[0]!.id, changedFiles: 4, movedToTrash: ['x'], stoppedProjects: ['bakery-site'], missingProjects: [] })
    })
    fireEvent.click(screen.getAllByTestId('version-restore')[1]!)
    const dialog = await screen.findByTestId('restore-dialog')
    expect(within(dialog).getByTestId('restore-summary').textContent).toBe("3 files will go back the way they were. 1 file made since then will move to Revive's trash.")
    expect(dialog.textContent).toContain('First, Revive will stop: Sunrise Bakery.')
    expect(mock.calls.some((c) => c.channel === 'versions:restore')).toBe(false)

    fireEvent.click(within(dialog).getByTestId('restore-confirm'))
    await waitFor(() => expect(mock.calls.find((c) => c.channel === 'versions:restore')?.args).toEqual({ versionId: VERSIONS[1]!.id }))
    await waitFor(() => expect(screen.queryByTestId('restore-dialog')).toBeNull())

    // The result arrives on the event stream (a restore made by another client shows the same way).
    act(() => mock.emit('runtime:event', restored))
    const done = await screen.findByTestId('restore-done')
    expect(done.textContent).toContain('Went back to the version from Sep 27, 2026')
    expect(done.textContent).toContain('3 files changed.')
    expect(within(done).getByTestId('start-again').textContent).toContain('Sunrise Bakery was running before. Start it again?')

    fireEvent.click(within(within(done).getByTestId('start-again')).getByText('Start'))
    expect(mock.calls.find((c) => c.channel === 'runner:start')?.args).toEqual({ projectId: 'bakery-site' })
    fireEvent.click(within(done).getByTestId('restore-undo'))
    await waitFor(() => expect(mock.calls.find((c) => c.channel === 'versions:undo')?.args).toEqual({ versionId: VERSIONS[0]!.id }))
  })

  it('explains in one sentence when it cannot go back right now', async () => {
    await openHistory({
      'versions:preview': () => ({ versionId: VERSIONS[1]!.id, changedFiles: 1, newFiles: 0, sample: [], willStop: [] }),
      'versions:restore': () => ({ ok: false, code: 'busy' })
    })
    fireEvent.click(screen.getAllByTestId('version-restore')[1]!)
    fireEvent.click(await within(await screen.findByTestId('restore-dialog')).findByTestId('restore-confirm'))
    expect((await screen.findByTestId('restore-problem')).textContent).toBe("Revive is reading the folder right now. Try again when it's done.")
  })

  it('empties the trash only after a clear confirmation', async () => {
    const mock = await openHistory({ 'trash:info': () => ({ items: 2, bytes: 3 * 1024 * 1024 }) })
    const trash = await screen.findByTestId('trash')
    await waitFor(() => expect(trash.textContent).toContain('2 files moved aside when going back (3 MB).'))
    fireEvent.click(within(trash).getByTestId('trash-empty'))
    const confirm = await screen.findByTestId('trash-confirm')
    expect(confirm.textContent).toContain("2 files will be deleted for good. This can't be undone.")
    fireEvent.click(within(confirm).getByText('Keep them'))
    expect(mock.calls.some((c) => c.channel === 'trash:empty')).toBe(false)
    fireEvent.click(within(trash).getByTestId('trash-empty'))
    fireEvent.click(within(await screen.findByTestId('trash-confirm')).getByTestId('trash-empty-confirm'))
    expect(mock.calls.find((c) => c.channel === 'trash:empty')?.args).toEqual({ confirm: true })
  })
})

describe('overlays over the live preview', () => {
  it('hide the preview first, show its latest picture in its place, and bring it back on close', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 100, left: 300, bottom: 660, right: 1200, width: 900, height: 560, x: 300, y: 100, toJSON: () => ({}) })
    let finishCover: () => void = () => {}
    const mock = installMockRevive(folder, {
      'manifest:get': () => ({ state: 'ok', manifest: sampleManifest() }),
      'versions:list': () => VERSIONS,
      'runner:list': () => [{ projectId: 'bakery-site', status: 'running', url: 'http://127.0.0.1:4000/', port: 4000, reason: null, command: null, updatedAt: '' }],
      'shots:list': () => ({ 'bakery-site': '/shots/bakery-site.png?v=1' }),
      'preview:cover': () => new Promise<void>((r) => (finishCover = r))
    })
    renderApp()
    // Wait for the live run list, so the card opens the running project instead of starting it.
    await waitFor(async () => expect((await screen.findByTestId('status-pill')).getAttribute('data-status')).toBe('running'))
    fireEvent.click(screen.getByTestId('card-action'))
    await screen.findByTestId('preview-frame')
    await waitFor(() => expect(mock.calls.some((c) => c.channel === 'preview:show')).toBe(true))

    fireEvent.click(screen.getByTestId('project-versions'))
    await waitFor(() => expect(mock.calls.some((c) => c.channel === 'preview:cover')).toBe(true))
    // Not drawn until main says the native view is hidden.
    expect(screen.queryByTestId('versions-dialog')).toBeNull()
    expect(screen.getByTestId('preview-frame').getAttribute('data-covered')).toBe('true')
    expect(screen.getByTestId('preview-standin').getAttribute('src')).toBe('revive://local/shots/bakery-site.png?v=1')
    const showsBefore = mock.calls.filter((c) => c.channel === 'preview:show').length

    await act(async () => finishCover())
    const dialog = await screen.findByTestId('versions-dialog')
    expect(within(dialog).getAllByTestId('versions-dialog-row')).toHaveLength(2)
    expect(mock.calls.filter((c) => c.channel === 'preview:show').length).toBe(showsBefore)

    fireEvent.click(within(dialog).getByText('Close'))
    await waitFor(() => expect(mock.calls.some((c) => c.channel === 'preview:uncover')).toBe(true))
    await waitFor(() => expect(mock.calls.filter((c) => c.channel === 'preview:show').length).toBeGreaterThan(showsBefore))
    expect(screen.queryByTestId('preview-standin')).toBeNull()
    rect.mockRestore()
  })
})
