// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@/i18n'
import { SettingsProvider } from '@/state/settings'
import { ProjectsProvider } from '@/state/projects'
import { App } from '@/App'
import { installMockRevive, READY_REPORT } from '@/test/mockRevive'
import { CLAUDE_INSTALL_COMMAND, type PrereqReport } from '@shared/prereq'

function renderApp() {
  return render(
    <SettingsProvider>
      <ProjectsProvider>
        <App />
      </ProjectsProvider>
    </SettingsProvider>
  )
}

const report = (patch: Partial<PrereqReport>): PrereqReport => ({ ...READY_REPORT, ...patch })

describe('onboarding', () => {
  it('goes from the check to the folder to My projects', async () => {
    const mock = installMockRevive({ uiLanguage: 'en' })
    renderApp()
    const next = await screen.findByTestId('prereq-continue')
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByTestId('onboarding-step').textContent).toBe('Step 1 of 2')
    fireEvent.click(next)

    const drop = await screen.findByTestId('folder-drop')
    const file = new File([''], 'my-ai-projects')
    await act(async () => fireEvent.drop(drop, { dataTransfer: { files: [file] } }))

    await screen.findByTestId('current-folder')
    expect(screen.getByTestId('current-folder').textContent).toContain('my-ai-projects')
    expect(mock.settings().lastFolder).toBe('/dropped/my-ai-projects')
    expect(mock.settings().recentFolders[0]).toBe('/dropped/my-ai-projects')
  })

  it('never runs the installer before the user confirms', async () => {
    const mock = installMockRevive({ uiLanguage: 'en' }, { 'prereq:check': () => report({ claude: { installed: false, version: null, signedIn: 'unknown' } }) })
    renderApp()
    fireEvent.click(await screen.findByTestId('install-start'))
    expect(mock.calls.some((c) => c.channel === 'prereq:installClaude')).toBe(false)

    const confirm = await screen.findByTestId('panel-install-confirm')
    fireEvent.click(within(confirm).getByText('Technical details'))
    expect(within(confirm).getByText(CLAUDE_INSTALL_COMMAND).closest('[dir="ltr"]')).toBeTruthy()

    fireEvent.click(screen.getByTestId('install-confirm'))
    await waitFor(() => expect(mock.calls.some((c) => c.channel === 'prereq:installClaude')).toBe(true))
    expect((screen.getByTestId('prereq-continue') as HTMLButtonElement).disabled).toBe(true)
  })

  it('checks again automatically after the install finishes', async () => {
    let installed = false
    const mock = installMockRevive(
      { uiLanguage: 'en' },
      {
        'prereq:check': () =>
          installed ? report({ claude: { installed: true, version: '2.1.282', signedIn: 'yes' } }) : report({ claude: { installed: false, version: null, signedIn: 'unknown' } })
      }
    )
    renderApp()
    fireEvent.click(await screen.findByTestId('install-start'))
    fireEvent.click(await screen.findByTestId('install-confirm'))
    await screen.findByTestId('panel-installing')
    act(() => mock.emit('prereq:task', { task: 'install-claude', phase: 'running', line: 'Installing Claude Code native build latest...' }))
    expect(screen.getByTestId('log-block').textContent).toContain('Installing Claude Code')

    installed = true
    act(() => mock.emit('prereq:task', { task: 'install-claude', phase: 'done' }))
    await waitFor(() => expect((screen.getByTestId('prereq-continue') as HTMLButtonElement).disabled).toBe(false))
  })

  it('asks to sign in, and falls back to a Terminal command in its own LTR block', async () => {
    const mock = installMockRevive({ uiLanguage: 'he' }, { 'prereq:check': () => report({ claude: { installed: true, version: '2.1.282', signedIn: 'no' } }) })
    renderApp()
    fireEvent.click(await screen.findByTestId('sign-in-start'))
    await waitFor(() => expect(mock.calls.some((c) => c.channel === 'prereq:signIn')).toBe(true))
    act(() => mock.emit('prereq:task', { task: 'sign-in', phase: 'failed' }))
    const panel = await screen.findByTestId('panel-sign-in')
    await waitFor(() => expect(within(panel).getByText('claude').getAttribute('dir')).toBe('ltr'))
    expect((screen.getByTestId('prereq-continue') as HTMLButtonElement).disabled).toBe(true)
  })

  it('lets you continue without Node.js but says what it means', async () => {
    installMockRevive({ uiLanguage: 'en' }, { 'prereq:check': () => report({ node: { installed: false, version: null } }) })
    renderApp()
    await screen.findByTestId('panel-node')
    expect((screen.getByTestId('prereq-continue') as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByTestId('prereq-node').getAttribute('data-state')).toBe('recommended')
  })

  it('explains a folder that is too broad in one plain sentence', async () => {
    installMockRevive({ uiLanguage: 'en' }, { 'folder:choose': (a) => ({ ok: false, path: (a as { path: string }).path, problem: 'too-broad' }) })
    renderApp()
    const next = await screen.findByTestId('prereq-continue')
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(next)
    const drop = await screen.findByTestId('folder-drop')
    await act(async () => fireEvent.drop(drop, { dataTransfer: { files: [new File([''], 'noa')] } }))
    expect((await screen.findByTestId('folder-problem')).textContent).toContain('too big')
  })
})
