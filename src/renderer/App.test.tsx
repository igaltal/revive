// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import '@/i18n'
import { AppProviders } from '@/state/AppProviders'
import { SettingsProvider } from '@/state/settings'
import { App } from '@/App'
import { LanguageSwitch } from '@/components/LanguageSwitch'
import { StatusPill } from '@/components/StatusPill'
import { ChevronForward, PlayIcon, UndoIcon } from '@/components/icons'
import { installMockRevive } from '@/test/mockRevive'

function renderApp() {
  return render(
    <AppProviders>
      <App />
    </AppProviders>
  )
}

describe('first run', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('dir')
  })

  it('asks for a language before anything else and stores the choice', async () => {
    const mock = installMockRevive({ uiLanguage: null })
    renderApp()
    fireEvent.click(await screen.findByTestId('welcome-he'))
    // Next comes the computer check, already in Hebrew and right to left.
    const step = await screen.findByTestId('onboarding-step')
    expect(mock.settings().uiLanguage).toBe('he')
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('he')
    expect(step.textContent).toBe('שלב 1 מתוך 2')
  })
})

describe('language switch', () => {
  it('flips words and direction instantly and keeps screen state', async () => {
    installMockRevive({ uiLanguage: 'en' })

    function Probe() {
      const [text, setText] = useState('')
      return <input aria-label="probe" value={text} onChange={(e) => setText(e.target.value)} />
    }

    render(
      <SettingsProvider>
        <Probe />
        <LanguageSwitch />
        <StatusPill status="verified" />
      </SettingsProvider>
    )
    await waitFor(() => expect(document.documentElement.dir).toBe('ltr'))
    fireEvent.change(screen.getByLabelText('probe'), { target: { value: 'my unsent note' } })
    expect(screen.getByText('Checked and working')).toBeTruthy()

    const started = performance.now()
    await act(async () => fireEvent.click(screen.getByTestId('lang-he')))
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'))
    expect(performance.now() - started).toBeLessThan(150)

    expect(screen.getByText('נבדק ועובד')).toBeTruthy()
    expect((screen.getByLabelText('probe') as HTMLInputElement).value).toBe('my unsent note')
  })
})

describe('status and icons', () => {
  it('shows status as a word plus a color', () => {
    installMockRevive({ uiLanguage: 'en' })
    render(
      <SettingsProvider>
        <StatusPill status="broken" />
      </SettingsProvider>
    )
    const pill = screen.getByText('Needs fixing').closest('[data-status]')!
    expect(pill.getAttribute('data-status')).toBe('broken')
    expect(pill.className).toContain('text-broken')
  })

  it('mirrors directional icons but not play or undo', () => {
    const { container } = render(
      <div>
        <ChevronForward />
        <PlayIcon />
        <UndoIcon />
      </div>
    )
    const [chevron, play, undo] = [...container.querySelectorAll('svg')]
    expect(chevron!.getAttribute('class')).toContain('rtl:-scale-x-100')
    expect(play!.getAttribute('class') ?? '').not.toContain('scale-x')
    expect(undo!.getAttribute('class') ?? '').not.toContain('scale-x')
  })
})
