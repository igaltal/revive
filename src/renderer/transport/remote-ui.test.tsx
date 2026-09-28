// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@/i18n'
import { capabilitiesFor } from '@shared/contract'
import { sampleManifest } from '@shared/test-fixtures'
import { AppProviders } from '@/state/AppProviders'
import { App } from '@/App'
import { installMockRevive, READY_REPORT } from '@/test/mockRevive'
import { installTransport } from '@/transport'
import { IpcTransport } from './ipc-transport'

/** The app as a remote client sees it: same contract, a WebSocket client's capabilities. */
class RemoteLike extends IpcTransport {
  capabilities() {
    return capabilitiesFor('ws')
  }
}

const folder = { uiLanguage: 'en' as const, lastFolder: '/Users/noa/ai-projects' }
afterEach(() => installTransport(null))

function renderRemote(handlers: Parameters<typeof installMockRevive>[1] = {}, settings = folder) {
  const mock = installMockRevive(settings, handlers)
  installTransport(new RemoteLike(window.revive))
  render(
    <AppProviders>
      <App />
    </AppProviders>
  )
  return mock
}

describe('a client without the desktop features', () => {
  it('shows the latest picture instead of the live preview, and never asks for native preview calls', async () => {
    const mock = renderRemote({
      'manifest:get': () => ({ state: 'ok', manifest: sampleManifest() }),
      'runner:list': () => [{ projectId: 'bakery-site', status: 'running', url: 'http://localhost:4000/', port: 4000, reason: null, command: null, updatedAt: '' }],
      'shots:list': () => ({ 'bakery-site': '/shots/bakery-site.png?v=1' })
    })
    await waitFor(async () => expect((await screen.findByTestId('status-pill')).getAttribute('data-status')).toBe('running'))
    fireEvent.click(screen.getByTestId('card-action'))
    expect((await screen.findByTestId('preview-remote')).textContent).toContain('running on the computer that runs Revive')
    expect(screen.queryByTestId('preview-frame')).toBeNull()
    expect(screen.queryByTestId('preview-open')).toBeNull()
    fireEvent.click(screen.getByTestId('project-versions'))
    await screen.findByTestId('versions-dialog')
    expect(mock.calls.filter((c) => c.channel.startsWith('preview:'))).toEqual([])
  })

  it("offers recent folders but no folder dialog or drop zone", async () => {
    renderRemote()
    fireEvent.click(await screen.findByTestId('change-folder'))
    expect(await screen.findByTestId('folder-remote')).toBeTruthy()
    expect(screen.queryByTestId('folder-pick')).toBeNull()
    expect(screen.queryByTestId('folder-drop')).toBeNull()
  })

  it("doesn't offer to install or sign in on the other computer", async () => {
    renderRemote({ 'prereq:check': () => ({ ...READY_REPORT, claude: { installed: false, version: null, signedIn: 'unknown' } }) }, { uiLanguage: 'en', lastFolder: null as never })
    expect(await screen.findByTestId('panel-install')).toBeTruthy()
    expect(screen.queryByTestId('install-start')).toBeNull()
    expect(screen.getByText('Do this on the computer that runs Revive.')).toBeTruthy()
    expect(screen.queryByText('Open the official page')).toBeNull()
  })
})
