// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@/i18n'
import { capabilitiesFor } from '@shared/contract'
import type { HostStatus } from '@shared/host'
import { sampleManifest } from '@shared/test-fixtures'
import { AppProviders } from '@/state/AppProviders'
import { App } from '@/App'
import { HOST_OFF, installMockRevive } from '@/test/mockRevive'

const folder = { uiLanguage: 'en' as const, lastFolder: '/Users/noa/ai-projects' }
const SHARING: HostStatus = { ...HOST_OFF, sharing: true, port: 52011, sleepMinutes: 30, tailscale: { state: 'serving', address: 'https://studio-mac.tail1234.ts.net' } }
const renderApp = () =>
  render(
    <AppProviders>
      <App />
    </AppProviders>
  )

describe('Host mode, on the Host', () => {
  it('turns sharing on, warns about sleep, shows how to reach it, and pairs with a code and a QR code', async () => {
    let host = HOST_OFF
    const mock = installMockRevive(folder, {
      'host:status': () => host,
      'host:setSharing': (a) => (host = (a as { on: boolean }).on ? SHARING : HOST_OFF),
      'host:startPairing': () => ({ code: '482913', expiresAt: new Date(Date.now() + 300_000).toISOString(), link: 'https://studio-mac.tail1234.ts.net/pair?code=482913', qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>' })
    })
    renderApp()
    fireEvent.click(await screen.findByTestId('nav-settings'))
    const sw = await screen.findByTestId('sharing-switch')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    await waitFor(() => expect(mock.calls.find((c) => c.channel === 'host:setSharing')?.args).toEqual({ on: true }))
    act(() => mock.emit('host:status', SHARING))
    expect((await screen.findByTestId('sleep-warning')).textContent).toContain('set to sleep after 30 minutes')
    expect(screen.getByText('https://studio-mac.tail1234.ts.net').getAttribute('dir')).toBe('ltr')

    const code = { code: '482913', expiresAt: new Date(Date.now() + 300_000).toISOString(), link: 'https://studio-mac.tail1234.ts.net/pair?code=482913', qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>' }
    fireEvent.click(screen.getByTestId('pair-start'))
    const dialog = await screen.findByTestId('pairing-dialog')
    act(() => mock.emit('host:status', { ...SHARING, pairing: code }))
    expect(within(dialog).getByTestId('pairing-code').textContent).toBe('482913')
    expect(within(dialog).getByTestId('pairing-qr').getAttribute('src')).toMatch(/^data:image\/svg\+xml;utf8,/)
    expect(dialog.textContent).toMatch(/Expires in \d+ seconds/)
    // A device used the code: the dialog goes, and the Host asks whether to allow it.
    act(() => mock.emit('host:status', { ...SHARING, pairing: null, requests: [{ id: 'r1', deviceName: 'Travel laptop', at: new Date().toISOString() }] }))
    await waitFor(() => expect(screen.queryByTestId('pairing-dialog')).toBeNull())
    expect((await screen.findByTestId('pairing-request')).textContent).toContain('Allow Travel laptop to connect?')

    // A fresh "Pair a device" gets a fresh dialog; closing it cancels the code.
    act(() => mock.emit('host:status', SHARING))
    fireEvent.click(screen.getByTestId('pair-start'))
    fireEvent.click(within(await screen.findByTestId('pairing-dialog')).getByText('Close'))
    await waitFor(() => expect(mock.calls.some((c) => c.channel === 'host:cancelPairing')).toBe(true))
  })

  it("asks before running tailscale serve, showing the exact command", async () => {
    const mock = installMockRevive(folder, { 'host:status': () => ({ ...SHARING, tailscale: { state: 'available', address: null } }) })
    renderApp()
    fireEvent.click(await screen.findByTestId('nav-settings'))
    fireEvent.click(await screen.findByTestId('tailscale-serve'))
    const confirm = await screen.findByTestId('tailscale-confirm')
    expect(within(confirm).getByText('tailscale serve --bg 52011').getAttribute('dir')).toBe('ltr')
    expect(mock.calls.some((c) => c.channel === 'host:exposeTailscale')).toBe(false)
    fireEvent.click(within(confirm).getByTestId('tailscale-serve-confirm'))
    expect(mock.calls.find((c) => c.channel === 'host:exposeTailscale')?.args).toEqual({ confirm: true })
  })

  it('explains in one sentence when Tailscale is missing', async () => {
    installMockRevive(folder, { 'host:status': () => ({ ...SHARING, tailscale: { state: 'missing', address: null } }) })
    renderApp()
    fireEvent.click(await screen.findByTestId('nav-settings'))
    expect((await screen.findByTestId('tailscale-missing')).textContent).toBe('To reach this Mac from your other computers, install Tailscale, a free private network.')
    expect(screen.getByText('Get Tailscale')).toBeTruthy()
  })

  it('asks "Allow <device> to connect?" from any screen, and nothing is allowed without the click', async () => {
    const mock = installMockRevive(folder, { 'manifest:get': () => ({ state: 'ok', manifest: sampleManifest() }) })
    renderApp()
    await screen.findAllByTestId('project-card')
    act(() => mock.emit('host:status', { ...SHARING, requests: [{ id: 'r1', deviceName: 'Travel laptop', at: new Date().toISOString() }] }))
    const ask = await screen.findByTestId('pairing-request')
    expect(ask.textContent).toContain('Allow Travel laptop to connect?')
    expect(mock.calls.some((c) => c.channel === 'host:answerPairing')).toBe(false)
    fireEvent.click(within(ask).getByTestId('pairing-allow'))
    expect(mock.calls.find((c) => c.channel === 'host:answerPairing')?.args).toEqual({ requestId: 'r1', allow: true })
  })

  it('lists devices with last seen, removes one only after confirming, and shows the activity by device', async () => {
    const mock = installMockRevive(folder, {
      'host:status': () => ({
        ...SHARING,
        devices: [
          { id: 'd1', name: 'Travel laptop', createdAt: '2026-09-28T08:00:00.000Z', lastSeenAt: '2026-09-28T09:00:00.000Z', online: false },
          { id: 'd2', name: 'Office iMac', createdAt: '2026-09-28T08:00:00.000Z', lastSeenAt: null, online: true }
        ]
      }),
      'host:activity': () => [
        { at: '2026-09-28T09:05:00.000Z', deviceId: 'd1', deviceName: 'Travel laptop', method: 'runner:start', summary: { projectId: 'bakery-site' } },
        { at: '2026-09-28T09:06:00.000Z', deviceId: 'local', deviceName: 'This computer', method: 'versions:restore', summary: { versionId: 'v-1' } }
      ]
    })
    renderApp()
    fireEvent.click(await screen.findByTestId('nav-settings'))
    const rows = await screen.findAllByTestId('device-row')
    expect(rows[0]!.textContent).toContain('Last seen Sep 28, 2026')
    expect(rows[1]!.textContent).toContain('Connected now')
    const activity = await screen.findAllByTestId('activity-row')
    expect(activity[0]!.textContent).toContain('Travel laptop · started · bakery-site')
    expect(activity[1]!.textContent).toContain('This computer · went back to a version')

    fireEvent.click(within(rows[0]!).getByTestId('device-revoke'))
    const confirm = await screen.findByTestId('revoke-confirm')
    expect(confirm.textContent).toContain('Remove Travel laptop?')
    expect(mock.calls.some((c) => c.channel === 'host:revokeDevice')).toBe(false)
    fireEvent.click(within(confirm).getByTestId('device-revoke-confirm'))
    expect(mock.calls.find((c) => c.channel === 'host:revokeDevice')?.args).toEqual({ deviceId: 'd1' })
  })
})

describe('client mode, on the other computer', () => {
  const connected = { state: 'open' as const, host: { name: 'Studio Mac', address: 'https://studio-mac.tail1234.ts.net' }, problem: null, capabilities: capabilitiesFor('ws') }

  it('connects with the address and the code, and waits for the Host to allow it', async () => {
    let status: unknown = { state: 'local', host: null, problem: null, capabilities: capabilitiesFor('ipc') }
    const mock = installMockRevive(folder, { 'client:status': () => status, 'client:connect': () => status })
    renderApp()
    fireEvent.click(await screen.findByTestId('nav-settings'))
    const form = await screen.findByTestId('connect-form')
    fireEvent.change(within(form).getByTestId('connect-address'), { target: { value: 'studio-mac.tail1234.ts.net' } })
    fireEvent.change(within(form).getByTestId('connect-code'), { target: { value: '48 29 13' } })
    fireEvent.click(within(form).getByTestId('connect-submit'))
    expect(mock.calls.find((c) => c.channel === 'client:connect')?.args).toEqual({ address: 'studio-mac.tail1234.ts.net', code: '482913', deviceName: 'My laptop' })
    status = { state: 'waiting', host: { name: 'Studio Mac', address: 'https://studio-mac.tail1234.ts.net' }, problem: null, capabilities: capabilitiesFor('ipc') }
    act(() => mock.emit('client:status', status as never))
    expect((await screen.findByTestId('connect-waiting')).textContent).toBe('Waiting for Studio Mac to allow this computer…')
    act(() => mock.emit('client:status', { state: 'local', host: null, problem: 'bad_code', capabilities: capabilitiesFor('ipc') }))
    expect((await screen.findByTestId('connect-problem')).textContent).toBe("That code didn't work. Check it on the other computer's screen.")
  })

  it('shows which computer and whether it is connected, hides the Host controls, and says where the preview runs', async () => {
    const mock = installMockRevive(folder, {
      'client:status': () => connected,
      'manifest:get': () => ({ state: 'ok', manifest: sampleManifest() }),
      'runner:list': () => [{ projectId: 'bakery-site', status: 'running', url: 'http://127.0.0.1:61234/', port: 61234, reason: null, command: null, updatedAt: '' }]
    })
    renderApp()
    const pill = await screen.findByTestId('connection-pill')
    expect(pill.textContent).toContain('Studio Mac')
    expect(pill.getAttribute('data-state')).toBe('open')
    act(() => mock.emit('client:status', { ...connected, state: 'reconnecting' }))
    await waitFor(() => expect(screen.getByTestId('connection-pill').textContent).toContain('Reconnecting…'))
    act(() => mock.emit('client:status', connected))

    await waitFor(async () => expect((await screen.findByTestId('status-pill')).getAttribute('data-status')).toBe('running'))
    fireEvent.click(screen.getByTestId('card-action'))
    const remote = await screen.findByTestId('preview-remote')
    expect(remote.textContent).toContain('Preview runs on Studio Mac.')
    expect(within(remote).getByText('http://127.0.0.1:61234/').getAttribute('dir')).toBe('ltr')
    expect(screen.queryByTestId('preview-frame')).toBeNull()

    fireEvent.click(screen.getByTestId('nav-settings'))
    expect((await screen.findByTestId('client-connected')).textContent).toContain('Connected to Studio Mac.')
    expect(screen.queryByTestId('sharing-switch')).toBeNull()
    expect(mock.calls.some((c) => c.channel.startsWith('host:'))).toBe(false)
  })

  it('says so, with a way back, when the Host can’t be reached or no longer allows this computer', async () => {
    installMockRevive(folder, { 'client:status': () => ({ ...connected, state: 'reconnecting' }), 'settings:get': () => new Promise(() => {}) })
    const { unmount } = renderApp()
    expect((await screen.findByTestId('client-connecting')).textContent).toContain('Connecting to Studio Mac…')
    unmount()
    const mock = installMockRevive(folder, { 'client:status': () => ({ ...connected, state: 'rejected', problem: 'revoked' }) })
    renderApp()
    const rejected = await screen.findByTestId('client-rejected')
    expect(rejected.textContent).toContain('Studio Mac no longer allows this computer')
    fireEvent.click(within(rejected).getByTestId('client-forget'))
    expect(mock.calls.some((c) => c.channel === 'client:disconnect')).toBe(true)
  })
})
